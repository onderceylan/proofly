import { logger } from '../../services/logger.ts';
import type { ProofreadCorrection } from '../../shared/types.ts';
import {
  normalizeIssueLabel,
  resolveElementKind,
  toSidepanelIssue,
  type IssueElementGroup,
  type IssueGroupError,
  type IssueGroupErrorCode,
  type IssuesUpdateMessage,
  type IssuesUpdatePayload,
} from '../../shared/messages/issues.ts';

export interface IssueManagerOptions {
  pageId: string;
  getElementId: (element: HTMLElement) => string;
  getElementText: (element: HTMLElement) => string;
  getActiveElement: () => HTMLElement | null;
}

export class IssueManager {
  private readonly elementCorrections = new Map<HTMLElement, ProofreadCorrection[]>();
  private readonly elementIssueLookup = new Map<HTMLElement, Map<string, ProofreadCorrection>>();
  private readonly elementMessages = new Map<
    HTMLElement,
    Map<IssueGroupErrorCode, IssueGroupError>
  >();
  private issuesRevision = 0;
  private pendingIssuesUpdate = false;

  constructor(private readonly options: IssueManagerOptions) {}

  setCorrections(element: HTMLElement, corrections: ProofreadCorrection[]): void {
    if (corrections.length === 0) {
      this.elementCorrections.delete(element);
      this.elementIssueLookup.delete(element);
      return;
    }

    this.elementCorrections.set(element, corrections);
    this.updateElementCorrectionLookup(element, corrections);
  }

  getCorrections(element: HTMLElement): ProofreadCorrection[] {
    return this.elementCorrections.get(element) ?? [];
  }

  getCorrection(element: HTMLElement, issueId: string): ProofreadCorrection | null {
    const lookup = this.elementIssueLookup.get(element);
    if (lookup?.has(issueId)) {
      return lookup.get(issueId) ?? null;
    }

    const corrections = this.elementCorrections.get(element);
    if (!corrections) {
      return null;
    }

    const validCorrections = corrections.filter(
      (correction) => correction.endIndex > correction.startIndex
    );
    for (let index = 0; index < validCorrections.length; index += 1) {
      const correction = validCorrections[index];
      const currentId = this.buildIssueId(correction, index);
      if (currentId === issueId) {
        return correction;
      }
    }

    return null;
  }

  setMessage(element: HTMLElement, message: IssueGroupError): void {
    const messages =
      this.elementMessages.get(element) ?? new Map<IssueGroupErrorCode, IssueGroupError>();
    const existing = messages.get(message.code);
    if (
      existing &&
      existing.message === message.message &&
      existing.severity === message.severity
    ) {
      return;
    }
    messages.set(message.code, message);
    this.elementMessages.set(element, messages);
    this.scheduleIssuesUpdate();
  }

  clearMessage(element: HTMLElement, code?: IssueGroupErrorCode): void {
    const messages = this.elementMessages.get(element);
    if (!messages) {
      return;
    }

    if (code) {
      if (!messages.delete(code)) {
        return;
      }
      if (messages.size === 0) {
        this.elementMessages.delete(element);
      }
    } else {
      this.elementMessages.delete(element);
    }

    this.scheduleIssuesUpdate();
  }

  clearState(element: HTMLElement): void {
    this.elementCorrections.delete(element);
    this.elementIssueLookup.delete(element);
    this.elementMessages.delete(element);
  }

  hasCorrections(): boolean {
    return this.elementCorrections.size > 0;
  }

  scheduleIssuesUpdate(flushImmediately = false): void {
    logger.info(
      { flushImmediately, pending: this.pendingIssuesUpdate },
      'Scheduling issues update'
    );
    if (flushImmediately) {
      this.pendingIssuesUpdate = false;
      this.emitIssuesUpdate();
      return;
    }
    if (this.pendingIssuesUpdate) {
      return;
    }
    this.pendingIssuesUpdate = true;
    queueMicrotask(() => {
      this.pendingIssuesUpdate = false;
      this.emitIssuesUpdate();
    });
  }

  emitIssuesUpdate(): void {
    const combinedEntries = new Map<HTMLElement, ProofreadCorrection[]>();
    for (const [element, corrections] of this.elementCorrections.entries()) {
      combinedEntries.set(element, corrections);
    }
    for (const element of this.elementMessages.keys()) {
      if (!combinedEntries.has(element)) {
        combinedEntries.set(element, []);
      }
    }

    const entries = Array.from(combinedEntries.entries()).filter(
      ([element, corrections]) => corrections.length > 0 || this.elementMessages.has(element)
    );
    entries.sort(([elementA], [elementB]) => {
      if (elementA === elementB) {
        return 0;
      }

      const position = elementA.compareDocumentPosition(elementB);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return -1;
      }
      if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return 1;
      }
      return 0;
    });

    const elements: IssueElementGroup[] = [];

    for (const [element, corrections] of entries) {
      const text = this.options.getElementText(element);
      const elementId = this.options.getElementId(element);
      logger.info(
        { elementId, label: normalizeIssueLabel(element), text },
        'Building issues entry'
      );

      const issues = corrections
        .filter((correction) => correction.endIndex > correction.startIndex)
        .map((correction, index) => {
          const issueId = this.buildIssueId(correction, index);
          const originalText = this.extractOriginalText(text, correction);
          return toSidepanelIssue(elementId, correction, originalText, issueId);
        })
        .filter((issue) => issue.originalText.length > 0 || issue.replacementText.length > 0);
      const groupMessages = this.getElementMessages(element);

      if (issues.length === 0 && (!groupMessages || groupMessages.length === 0)) {
        continue;
      }

      elements.push({
        elementId,
        domId: element.id ? element.id : null,
        kind: resolveElementKind(element),
        label: normalizeIssueLabel(element),
        issues,
        errors: groupMessages ?? null,
      });
    }

    const activeElement = this.options.getActiveElement();
    const activeElementId = activeElement ? this.options.getElementId(activeElement) : null;
    const activeElementLabel = activeElement ? normalizeIssueLabel(activeElement) : null;
    const activeElementKind = activeElement ? resolveElementKind(activeElement) : null;

    const payload: IssuesUpdatePayload = {
      pageId: this.options.pageId,
      activeElementId,
      activeElementLabel,
      activeElementKind,
      elements,
      revision: ++this.issuesRevision,
    };

    const issueTotal = elements.reduce((count, group) => count + group.issues.length, 0);
    logger.info(
      { issueTotal, revision: this.issuesRevision, elementGroups: elements.length },
      'Emitting issues update'
    );

    const message: IssuesUpdateMessage = {
      type: 'proofly:issues-update',
      payload,
    };

    void chrome.runtime.sendMessage(message).catch((error) => {
      logger.warn({ error }, 'Failed to broadcast issues update');
    });

    if (issueTotal === 0) {
      void chrome.runtime.sendMessage({ type: 'proofly:clear-badge' }).catch((error) => {
        logger.warn({ error }, 'Failed to request badge clear');
      });
    }
  }

  private updateElementCorrectionLookup(
    element: HTMLElement,
    corrections: ProofreadCorrection[]
  ): void {
    if (corrections.length === 0) {
      this.elementIssueLookup.delete(element);
      return;
    }

    const lookup = new Map<string, ProofreadCorrection>();
    corrections
      .filter((correction) => correction.endIndex > correction.startIndex)
      .forEach((correction, index) => {
        lookup.set(this.buildIssueId(correction, index), correction);
      });

    this.elementIssueLookup.set(element, lookup);
  }

  private buildIssueId(correction: ProofreadCorrection, index: number): string {
    return `${correction.startIndex}:${correction.endIndex}:${index}`;
  }

  private extractOriginalText(text: string, correction: ProofreadCorrection): string {
    if (!text) {
      return '';
    }

    const maxIndex = text.length;
    const safeStart = Math.max(0, Math.min(correction.startIndex, maxIndex));
    const safeEnd = Math.max(safeStart, Math.min(correction.endIndex, maxIndex));
    return text.slice(safeStart, safeEnd);
  }

  private getElementMessages(element: HTMLElement): IssueGroupError[] | null {
    const messages = this.elementMessages.get(element);
    if (!messages || messages.size === 0) {
      return null;
    }
    return Array.from(messages.values());
  }
}
