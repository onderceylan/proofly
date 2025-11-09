import { AsyncQueue } from '../shared/utils/queue.ts';
import { ContentHighlighter } from './components/content-highlighter.ts';
import {
  createProofreader,
  createProofreaderAdapter,
  createProofreadingService,
} from '../services/proofreader.ts';
import {
  createLanguageDetector,
  createLanguageDetectorAdapter,
  createLanguageDetectionService,
} from '../services/language-detector.ts';
import './components/correction-popover.ts';
import type { CorrectionPopover } from './components/correction-popover.ts';
import { logger } from '../services/logger.ts';
import { getStorageValues, onStorageChange } from '../shared/utils/storage.ts';
import { STORAGE_KEYS, STORAGE_DEFAULTS } from '../shared/constants.ts';
import {
  buildCorrectionColorThemes,
  getActiveCorrectionColors,
  setActiveCorrectionColors,
  type CorrectionColorConfig,
  type CorrectionColorThemeMap,
  type CorrectionTypeKey,
} from '../shared/utils/correction-types.ts';
import {
  createProofreadingController,
  type ProofreadLifecycleInternalEvent,
  type ProofreadRunContext,
} from '../shared/proofreading/controller.ts';
import {
  isProofreadTarget,
  isSpellcheckDisabled,
  shouldMirrorOnElement,
  shouldProofread,
} from '../shared/proofreading/target-selectors.ts';
import type { ProofreadingTargetHooks } from '../shared/proofreading/types.ts';
import type { ProofreadCorrection, ProofreadResult, UnderlineStyle } from '../shared/types.ts';
import {
  TargetSession,
  type Issue as SessionIssue,
  type IssueColorPalette,
} from './target-session.ts';
import { isMacOS } from '../shared/utils/platform.ts';
import {
  normalizeIssueLabel,
  resolveElementKind,
  toSidepanelIssue,
  type IssueElementGroup,
  type IssueGroupErrorCode,
  type IssueGroupError,
  type IssuesUpdateMessage,
  type IssuesUpdatePayload,
} from '../shared/messages/issues.ts';
import {
  emitProofreadControlEvent,
  type ProofreadLifecycleReason,
} from '../shared/proofreading/control-events.ts';

export class ProofreadingManager {
  private readonly highlighter = new ContentHighlighter();
  private readonly elementSessions = new Map<HTMLElement, TargetSession>();
  private readonly elementIssueLookup = new Map<HTMLElement, Map<string, ProofreadCorrection>>();
  private readonly proofreaderServices = new Map<
    string,
    ReturnType<typeof createProofreadingService>
  >();
  private readonly proofreadQueue = new AsyncQueue();
  private readonly registeredElements = new Set<HTMLElement>();

  private popover: CorrectionPopover | null = null;
  private popoverHideCleanup: (() => void) | null = null;
  private observer: MutationObserver | null = null;
  private activeElement: HTMLElement | null = null;
  private activeSessionElement: HTMLElement | null = null;
  private readonly pageId = crypto.randomUUID();
  private readonly elementIds = new WeakMap<HTMLElement, string>();
  private readonly elementLookup = new Map<string, HTMLElement>();
  private readonly elementCorrections = new Map<HTMLElement, ProofreadCorrection[]>();
  private readonly elementMessages = new Map<
    HTMLElement,
    Map<IssueGroupErrorCode, IssueGroupError>
  >();
  private lastProofreaderBusy = false;
  private pendingIssuesUpdate = false;
  private issuesRevision = 0;
  private controller = createProofreadingController({
    runProofread: (element, text, context) => this.runProofread(element, text, context),
    filterCorrections: (_element, corrections, text) => this.filterCorrections(corrections, text),
    debounceMs: 1000,
    getElementText: (element) => this.getElementText(element),
    onLifecycleEvent: (event) => this.handleProofreadLifecycle(event),
  });
  private languageDetectionService: ReturnType<typeof createLanguageDetectionService> | null = null;
  private enabledCorrectionTypes = new Set<CorrectionTypeKey>();
  private correctionTypeCleanup: (() => void) | null = null;
  private correctionColors: CorrectionColorThemeMap = getActiveCorrectionColors();
  private correctionColorsCleanup: (() => void) | null = null;
  private underlineStyle: UnderlineStyle = STORAGE_DEFAULTS[
    STORAGE_KEYS.UNDERLINE_STYLE
  ] as UnderlineStyle;
  private underlineStyleCleanup: (() => void) | null = null;
  private autoCorrectEnabled: boolean = STORAGE_DEFAULTS[STORAGE_KEYS.AUTO_CORRECT] as boolean;
  private proofreadShortcut: string = STORAGE_DEFAULTS[STORAGE_KEYS.PROOFREAD_SHORTCUT] as string;
  private autofixOnDoubleClick: boolean = STORAGE_DEFAULTS[
    STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK
  ] as boolean;
  private autoCorrectCleanup: (() => void) | null = null;
  private shortcutStorageCleanup: (() => void) | null = null;
  private autofixCleanup: (() => void) | null = null;
  private shortcutKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private readonly isMacPlatform = isMacOS();

  async initialize(): Promise<void> {
    await this.initializeLanguageDetection();
    this.createPopover();
    await this.initializeCorrectionPreferences();
    await this.initializeProofreadPreferences();
    this.observeEditableElements();
    this.emitIssuesUpdate();
    logger.info('Proofreading manager ready');
  }

  private async initializeLanguageDetection(): Promise<void> {
    try {
      const detector = await createLanguageDetector();
      const adapter = createLanguageDetectorAdapter(detector);
      this.languageDetectionService = createLanguageDetectionService(adapter);
      logger.info('Language detection service initialized');
    } catch (error) {
      logger.warn({ error }, 'Language detection unavailable, using English fallback');
      this.languageDetectionService = null;
    }
  }

  private createPopover(): void {
    if (document.querySelector('proofly-correction-popover')) {
      this.popover = document.querySelector('proofly-correction-popover') as CorrectionPopover;
    } else {
      this.popover = document.createElement('proofly-correction-popover') as CorrectionPopover;
      document.body.appendChild(this.popover);
    }

    this.cleanupHandler(this.popoverHideCleanup);

    if (this.popover) {
      const handlePopoverHide = () => {
        this.highlighter.clearSelection();
        if (this.activeSessionElement) {
          const session = this.elementSessions.get(this.activeSessionElement);
          session?.clearActiveIssue();
          this.activeSessionElement = null;
        }
      };
      this.popover.addEventListener('proofly:popover-hide', handlePopoverHide);
      this.popoverHideCleanup = () => {
        this.popover?.removeEventListener('proofly:popover-hide', handlePopoverHide);
      };
    }
  }

  private cleanupHandler(cleanup: (() => void) | null): void {
    cleanup?.();
  }

  private observeEditableElements(): void {
    const handleInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (!this.isEditableElement(target)) {
        const reason: ProofreadLifecycleReason =
          isSpellcheckDisabled(target) && isProofreadTarget(target)
            ? 'spellcheck-disabled'
            : 'unsupported-target';
        this.reportIgnoredElement(target, reason);
        return;
      }
      this.clearElementMessage(target);
      this.registerElement(target);
      if (shouldMirrorOnElement(target)) {
        return;
      }
      if (this.shouldAutoProofread()) {
        this.controller.scheduleProofread(target);
      }
    };

    const handleFocus = (event: Event) => {
      const target = event.target as HTMLElement;
      if (!this.isEditableElement(target)) {
        return;
      }
      this.activeElement = target;
      this.registerElement(target);
      if (this.shouldAutoProofread()) {
        void this.controller.proofread(target);
      }
      this.emitIssuesUpdate();
    };

    const handleBlur = (event: Event) => {
      const target = event.target as HTMLElement;
      if (this.activeElement === target) {
        this.activeElement = null;
      }
    };

    document.addEventListener('input', handleInput, true);
    document.addEventListener('focus', handleFocus, true);
    document.addEventListener('blur', handleBlur, true);

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const element = node as HTMLElement;
          if (this.isEditableElement(element)) {
            this.registerElement(element);
            if (this.shouldAutoProofread()) {
              void this.controller.proofread(element);
            }
          }
        });
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private registerElement(element: HTMLElement): void {
    if (this.registeredElements.has(element)) {
      return;
    }

    this.registeredElements.add(element);
    this.getElementId(element);

    const hooks = this.createTargetHooks(element);
    this.controller.registerTarget({ element, hooks });

    if (shouldMirrorOnElement(element)) {
      this.ensureTargetSession(element as HTMLTextAreaElement | HTMLInputElement);
    } else {
      this.setupContentEditableCallbacks(element);
    }
  }

  private createTargetHooks(element: HTMLElement): ProofreadingTargetHooks {
    if (shouldMirrorOnElement(element)) {
      return {
        highlight: (corrections) => {
          this.highlightWithSession(element as HTMLTextAreaElement | HTMLInputElement, corrections);
        },
        clearHighlights: () => {
          this.clearSessionHighlights(element as HTMLTextAreaElement | HTMLInputElement);
        },
        onCorrectionsChange: (corrections) => {
          this.handleCorrectionsChange(element, corrections);
        },
      };
    }

    return {
      highlight: (corrections) => {
        this.highlighter.highlight(element, corrections);
      },
      clearHighlights: () => {
        this.highlighter.clearHighlights(element);
      },
      onCorrectionsChange: (corrections) => {
        this.handleCorrectionsChange(element, corrections);
      },
    };
  }

  private ensureTargetSession(element: HTMLTextAreaElement | HTMLInputElement): TargetSession {
    let session = this.elementSessions.get(element);
    if (!session) {
      session = new TargetSession(element, {
        onNeedProofread: () => {
          if (this.shouldAutoProofread()) {
            this.controller.scheduleProofread(element);
          }
        },
        onUnderlineClick: (issueId, pageRect) => {
          this.activeSessionElement = element;
          const lookup = this.elementIssueLookup.get(element);
          const correction = lookup?.get(issueId);
          if (!correction) {
            return;
          }
          const anchorX = pageRect.left + pageRect.width / 2;
          const anchorY = pageRect.top + pageRect.height;
          this.showPopoverForCorrection(element, correction, anchorX, anchorY);
        },
        onUnderlineDoubleClick: (issueId) => {
          const lookup = this.elementIssueLookup.get(element);
          const correction = lookup?.get(issueId);
          if (!correction) {
            return;
          }
          // Apply correction immediately without showing popover
          this.controller.applyCorrection(element, correction);
          this.scheduleIssuesUpdate();
        },
        onInvalidateIssues: () => {
          if (!this.controller.isRestoringFromHistory(element)) {
            this.clearSessionHighlights(element, { silent: true });
          }
        },
      });
      session.attach();
      session.setColorPalette(this.buildIssuePalette());
      session.setUnderlineStyle(this.underlineStyle);
      session.setAutofixOnDoubleClick(this.autofixOnDoubleClick);
      this.elementSessions.set(element, session);
    }
    return session;
  }

  private highlightWithSession(
    element: HTMLTextAreaElement | HTMLInputElement,
    corrections: ProofreadCorrection[]
  ): void {
    const session = this.ensureTargetSession(element);
    const mapped = this.mapCorrectionsToIssues(corrections);
    const lookup = new Map<string, ProofreadCorrection>();
    const issues: SessionIssue[] = [];
    for (const { issue, correction } of mapped) {
      lookup.set(issue.id, correction);
      issues.push(issue);
    }
    if (issues.length > 0) {
      this.elementIssueLookup.set(element, lookup);
    } else {
      this.elementIssueLookup.delete(element);
    }
    session.setIssues(issues);
  }

  private clearSessionHighlights(
    element: HTMLTextAreaElement | HTMLInputElement,
    options: { silent?: boolean } = {}
  ): void {
    const session = this.elementSessions.get(element);
    session?.setIssues([]);
    session?.clearActiveIssue();
    const hadCorrections = this.elementCorrections.has(element);
    if (options.silent) {
      if (this.activeSessionElement === element) {
        this.activeSessionElement = null;
      }
      if (hadCorrections) {
        this.elementIssueLookup.delete(element);
        this.elementCorrections.delete(element);
        this.scheduleIssuesUpdate(true);
      }
      return;
    }

    this.elementIssueLookup.delete(element);
    this.elementCorrections.delete(element);
    if (this.activeSessionElement === element) {
      this.activeSessionElement = null;
    }
    this.emitIssuesUpdate();
  }

  private mapCorrectionsToIssues(
    corrections: ProofreadCorrection[]
  ): Array<{ issue: SessionIssue; correction: ProofreadCorrection }> {
    return corrections
      .map((correction, index) => ({ correction, index }))
      .filter(({ correction }) => correction.endIndex > correction.startIndex)
      .map(({ correction, index }) => ({
        issue: {
          id: this.buildIssueId(correction, index),
          start: correction.startIndex,
          end: correction.endIndex,
          type: this.toIssueType(correction),
        },
        correction,
      }));
  }

  private buildIssueId(correction: ProofreadCorrection, index: number): string {
    return `${correction.startIndex}:${correction.endIndex}:${correction.type ?? 'unknown'}:${index}`;
  }

  private toIssueType(correction: ProofreadCorrection): SessionIssue['type'] {
    const type = correction.type as CorrectionTypeKey | undefined;
    if (type && this.correctionColors[type]) {
      return type;
    }
    return 'spelling';
  }

  private buildIssuePalette(): IssueColorPalette {
    return structuredClone(this.correctionColors);
  }

  private setupContentEditableCallbacks(element: HTMLElement): void {
    this.highlighter.setApplyCorrectionCallback(element, (_target, correction) => {
      this.controller.applyCorrection(element, correction);
      this.scheduleIssuesUpdate();
    });

    this.highlighter.setOnCorrectionApplied(element, (updatedCorrections) => {
      this.handleCorrectionsChange(element, updatedCorrections);
    });
  }

  private handleCorrectionsChange(element: HTMLElement, corrections: ProofreadCorrection[]): void {
    this.storeElementCorrections(element, corrections);
    this.updateElementCorrectionLookup(element, corrections);
    this.scheduleIssuesUpdate(corrections.length === 0);
  }

  private reportProofreaderBusy(busy: boolean): void {
    if (this.lastProofreaderBusy === busy) {
      return;
    }

    this.lastProofreaderBusy = busy;

    try {
      void chrome.runtime
        .sendMessage({ type: 'proofly:proofreader-state', payload: { busy } })
        .catch((error) => {
          logger.warn({ error }, 'Failed to notify background of proofreader state');
        });
    } catch (error) {
      logger.warn({ error }, 'Proofreader state notification threw unexpectedly');
    }
  }

  private storeElementCorrections(element: HTMLElement, corrections: ProofreadCorrection[]): void {
    if (corrections.length === 0) {
      this.elementCorrections.delete(element);
      return;
    }

    this.elementCorrections.set(element, corrections);
  }

  private setElementMessage(element: HTMLElement, message: IssueGroupError): void {
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

  private clearElementMessage(element: HTMLElement, code?: IssueGroupErrorCode): void {
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

  private getElementMessages(element: HTMLElement): IssueGroupError[] | null {
    const messages = this.elementMessages.get(element);
    if (!messages || messages.size === 0) {
      return null;
    }
    return Array.from(messages.values());
  }

  private buildUnsupportedLanguageError(language: string, errorMessage?: string): IssueGroupError {
    const languageLabel = language?.trim() || 'unknown';
    const details = errorMessage ? ` Reason: ${errorMessage}` : '';
    return {
      code: 'unsupported-language',
      severity: 'error',
      message: `Proofreader API rejected language "${languageLabel}".${details}`.trim(),
      details: {
        language: languageLabel,
      },
    };
  }

  private buildLanguageDetectionUnconfidentWarning(): IssueGroupError {
    return {
      code: 'language-detection-unconfident',
      severity: 'warning',
      message:
        "Could not confidently detect this field's language. Defaulting to English for proofreading.",
    };
  }

  private buildLanguageDetectionError(): IssueGroupError {
    return {
      code: 'language-detection-error',
      severity: 'error',
      message:
        'Language detection failed on this field. Defaulting to English; results might be less accurate.',
    };
  }

  private isUnsupportedLanguageError(error: unknown): boolean {
    if (!error) {
      return false;
    }
    const message = this.extractErrorMessage(error)?.toLowerCase() ?? '';
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return message.includes('language');
    }
    return message.includes('language options') || message.includes('unsupported language');
  }

  private extractErrorMessage(error: unknown): string | null {
    if (!error) {
      return null;
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return null;
  }

  private getLanguageCacheKey(language: string): string {
    return language.trim().toLowerCase() || 'unknown';
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

  private emitIssuesUpdate(): void {
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
      const text = this.getElementText(element);
      const elementId = this.getElementId(element);
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

    const activeElementId = this.activeElement ? this.getElementId(this.activeElement) : null;
    const activeElementLabel = this.activeElement ? normalizeIssueLabel(this.activeElement) : null;
    const activeElementKind = this.activeElement ? resolveElementKind(this.activeElement) : null;

    const payload: IssuesUpdatePayload = {
      pageId: this.pageId,
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

  private extractOriginalText(text: string, correction: ProofreadCorrection): string {
    if (!text) {
      return '';
    }

    const maxIndex = text.length;
    const safeStart = Math.max(0, Math.min(correction.startIndex, maxIndex));
    const safeEnd = Math.max(safeStart, Math.min(correction.endIndex, maxIndex));
    return text.slice(safeStart, safeEnd);
  }

  private getElementId(element: HTMLElement): string {
    let identifier = this.elementIds.get(element);
    if (!identifier) {
      identifier = crypto.randomUUID();
      this.elementIds.set(element, identifier);
      this.elementLookup.set(identifier, element);
    }
    return identifier;
  }

  applyIssue(elementId: string, issueId: string): void {
    const element = this.elementLookup.get(elementId);
    if (!element) {
      logger.warn({ elementId, issueId }, 'Issue apply requested for unknown element');
      return;
    }

    const correction = this.resolveCorrectionForIssue(element, issueId);
    if (!correction) {
      logger.warn({ elementId, issueId }, 'Missing correction for requested issue');
      return;
    }

    this.controller.applyCorrection(element, correction);
    this.scheduleIssuesUpdate();
  }

  applyAllIssues(): void {
    const elements = Array.from(this.elementCorrections.keys());
    if (elements.length === 0) {
      logger.info('Fix all requested but no issues are available');
      return;
    }

    this.reportProofreaderBusy(true);
    try {
      for (const element of elements) {
        if (!element) {
          continue;
        }

        let safetyCounter = 0;
        while (true) {
          const corrections = this.controller.getCorrections(element);
          if (!corrections || corrections.length === 0) {
            break;
          }

          const [nextCorrection] = corrections;
          this.controller.applyCorrection(element, nextCorrection);
          safetyCounter += 1;

          if (safetyCounter > 1000) {
            logger.warn({ element }, 'Stopping bulk apply due to iteration safety limit');
            break;
          }
        }
      }

      this.scheduleIssuesUpdate();
      logger.info('Applied all outstanding issues');
    } finally {
      this.reportProofreaderBusy(false);
    }
  }

  private resolveCorrectionForIssue(
    element: HTMLElement,
    issueId: string
  ): ProofreadCorrection | null {
    const lookup = this.elementIssueLookup.get(element);
    if (lookup?.has(issueId)) {
      return lookup.get(issueId) ?? null;
    }

    const corrections = this.elementCorrections.get(element);
    if (!corrections) {
      return null;
    }

    for (let index = 0; index < corrections.length; index += 1) {
      const correction = corrections[index];
      const currentId = this.buildIssueId(correction, index);
      if (currentId === issueId) {
        return correction;
      }
    }

    return null;
  }

  private async runProofread(
    element: HTMLElement,
    text: string,
    context: ProofreadRunContext
  ): Promise<ProofreadResult | null> {
    return this.proofreadQueue.enqueue(async () => {
      let detectedLanguage: string | null = null;

      if (this.languageDetectionService) {
        try {
          detectedLanguage = await this.languageDetectionService.detectLanguage(text);
          if (detectedLanguage) {
            this.clearElementMessage(element, 'language-detection-unconfident');
            this.clearElementMessage(element, 'language-detection-error');
          } else {
            this.setElementMessage(element, this.buildLanguageDetectionUnconfidentWarning());
            this.clearElementMessage(element, 'language-detection-error');
          }
        } catch (error) {
          logger.warn({ error }, 'Language detection failed, falling back to English');
          this.clearElementMessage(element, 'language-detection-unconfident');
          this.setElementMessage(element, this.buildLanguageDetectionError());
          detectedLanguage = null;
        }
      } else {
        this.clearElementMessage(element, 'language-detection-unconfident');
        this.clearElementMessage(element, 'language-detection-error');
      }

      const requestedLanguage = detectedLanguage ?? 'unknown';
      this.handleProofreadLifecycle({
        status: 'language-detected',
        element,
        executionId: context.executionId,
        textLength: text.length,
        language: detectedLanguage,
        fallbackLanguage: 'en',
      });

      let service: ReturnType<typeof createProofreadingService>;
      try {
        service = await this.getOrCreateProofreaderService(requestedLanguage);
      } catch (error) {
        if (this.isUnsupportedLanguageError(error)) {
          const message = this.extractErrorMessage(error);
          this.setElementMessage(
            element,
            this.buildUnsupportedLanguageError(requestedLanguage, message ?? undefined)
          );
          logger.warn(
            { language: requestedLanguage, error: message },
            'Proofreader rejected requested language'
          );
          return null;
        }
        throw error;
      }

      this.clearElementMessage(element, 'unsupported-language');

      if (!service.canProofread(text)) {
        return null;
      }

      try {
        return await service.proofread(text);
      } catch (error) {
        if (this.isUnsupportedLanguageError(error)) {
          const message = this.extractErrorMessage(error);
          this.setElementMessage(
            element,
            this.buildUnsupportedLanguageError(requestedLanguage, message ?? undefined)
          );
          logger.warn(
            { language: requestedLanguage, error: message },
            'Proofreader rejected proofreading request'
          );
          return null;
        }
        throw error;
      }
    });
  }

  private filterCorrections(
    corrections: ProofreadCorrection[],
    text: string
  ): ProofreadCorrection[] {
    const trimmedLength = text.trimEnd().length;
    return corrections
      .filter((correction) => correction.startIndex < trimmedLength)
      .filter((correction) => this.isCorrectionEnabled(correction));
  }

  private handleCorrectionFromPopover(element: HTMLElement, correction: ProofreadCorrection): void {
    this.controller.applyCorrection(element, correction);
    this.scheduleIssuesUpdate();
  }

  private isCorrectionEnabled(correction: ProofreadCorrection): boolean {
    if (this.enabledCorrectionTypes.size === 0) {
      return false;
    }

    if (!correction.type) {
      return true;
    }

    return this.enabledCorrectionTypes.has(correction.type as CorrectionTypeKey);
  }

  private showPopoverForCorrection(
    element: HTMLElement,
    correction: ProofreadCorrection,
    x: number,
    y: number
  ): void {
    if (!this.popover) {
      return;
    }

    const elementText = this.getElementText(element);
    const issueText = elementText.substring(correction.startIndex, correction.endIndex);

    this.popover.setCorrection(correction, issueText, (applied) => {
      this.handleCorrectionFromPopover(element, applied);
    });

    this.popover.show(x, y);
  }

  private async initializeCorrectionPreferences(): Promise<void> {
    const { enabledCorrectionTypes, correctionColors, underlineStyle } = await getStorageValues([
      STORAGE_KEYS.ENABLED_CORRECTION_TYPES,
      STORAGE_KEYS.CORRECTION_COLORS,
      STORAGE_KEYS.UNDERLINE_STYLE,
    ]);

    this.enabledCorrectionTypes = new Set(enabledCorrectionTypes);

    const colorConfig: CorrectionColorConfig = structuredClone(correctionColors);
    this.updateCorrectionColors(colorConfig);
    this.updateUnderlineStyle(underlineStyle);

    this.cleanupHandler(this.correctionTypeCleanup);
    this.correctionTypeCleanup = onStorageChange(
      STORAGE_KEYS.ENABLED_CORRECTION_TYPES,
      (newValue) => {
        this.enabledCorrectionTypes = new Set(newValue);
        this.refreshCorrectionsForTrackedElements();
      }
    );

    this.cleanupHandler(this.correctionColorsCleanup);
    this.correctionColorsCleanup = onStorageChange(STORAGE_KEYS.CORRECTION_COLORS, (newValue) => {
      const updatedConfig: CorrectionColorConfig = structuredClone(newValue);
      this.updateCorrectionColors(updatedConfig);
    });

    this.cleanupHandler(this.underlineStyleCleanup);
    this.underlineStyleCleanup = onStorageChange(STORAGE_KEYS.UNDERLINE_STYLE, (newValue) => {
      this.updateUnderlineStyle(newValue);
    });
  }

  private async initializeProofreadPreferences(): Promise<void> {
    const { autoCorrect, proofreadShortcut, autofixOnDoubleClick } = await getStorageValues([
      STORAGE_KEYS.AUTO_CORRECT,
      STORAGE_KEYS.PROOFREAD_SHORTCUT,
      STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK,
    ]);

    this.autoCorrectEnabled = autoCorrect;
    this.proofreadShortcut = proofreadShortcut;
    this.autofixOnDoubleClick = autofixOnDoubleClick;
    this.setupShortcutListener();

    this.cleanupHandler(this.autoCorrectCleanup);
    this.autoCorrectCleanup = onStorageChange(STORAGE_KEYS.AUTO_CORRECT, (newValue) => {
      this.autoCorrectEnabled = newValue;
      if (!newValue) {
        this.controller.cancelPendingProofreads();
      }
      if (newValue && this.activeElement) {
        void this.controller.proofread(this.activeElement, { force: true });
      }
    });

    this.cleanupHandler(this.shortcutStorageCleanup);
    this.shortcutStorageCleanup = onStorageChange(STORAGE_KEYS.PROOFREAD_SHORTCUT, (newValue) => {
      this.proofreadShortcut = newValue;
    });

    this.cleanupHandler(this.autofixCleanup);
    this.autofixCleanup = onStorageChange(STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK, (newValue) => {
      this.updateAutofixOnDoubleClick(newValue);
    });
  }

  private updateCorrectionColors(colorConfig: CorrectionColorConfig): void {
    this.correctionColors = buildCorrectionColorThemes(colorConfig);
    setActiveCorrectionColors(colorConfig);
    this.highlighter.setCorrectionColors(this.correctionColors);
    const palette = this.buildIssuePalette();
    this.elementSessions.forEach((session) => session.setColorPalette(palette));
  }

  private updateUnderlineStyle(style: UnderlineStyle): void {
    if (this.underlineStyle === style) {
      return;
    }
    this.underlineStyle = style;
    this.elementSessions.forEach((session) => session.setUnderlineStyle(style));
  }

  private updateAutofixOnDoubleClick(enabled: boolean): void {
    this.autofixOnDoubleClick = enabled;
    this.elementSessions.forEach((session) => session.setAutofixOnDoubleClick(enabled));
  }

  private scheduleIssuesUpdate(flushImmediately = false): void {
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

  private refreshCorrectionsForTrackedElements(): void {
    for (const element of this.registeredElements) {
      if (this.isEditableElement(element)) {
        void this.controller.proofread(element);
      }
    }
  }

  private shouldAutoProofread(): boolean {
    return this.autoCorrectEnabled;
  }

  private setupShortcutListener(): void {
    if (this.shortcutKeydownHandler) {
      return;
    }

    this.shortcutKeydownHandler = (event: KeyboardEvent) => {
      if (!this.autoCorrectEnabled && this.matchesShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        void this.proofreadActiveElement();
      }
    };

    document.addEventListener('keydown', this.shortcutKeydownHandler, true);
  }

  private matchesShortcut(event: KeyboardEvent): boolean {
    if (!this.proofreadShortcut) {
      return false;
    }

    const combo = this.buildShortcutFromEvent(event);
    return combo !== null && combo === this.proofreadShortcut;
  }

  private buildShortcutFromEvent(event: KeyboardEvent): string | null {
    const key = event.key;

    const modifiers: string[] = [];
    const modPressed = this.isMacPlatform ? event.metaKey : event.ctrlKey;
    if (modPressed) {
      modifiers.push('Mod');
    }

    if (event.altKey) {
      modifiers.push('Alt');
    }

    if (event.shiftKey) {
      modifiers.push('Shift');
    }

    if (key === 'Escape') {
      return null;
    }

    if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') {
      return null;
    }

    if (modifiers.length === 0) {
      return null;
    }

    let normalizedKey: string;
    if (key === ' ') {
      normalizedKey = 'Space';
    } else if (key.length === 1) {
      normalizedKey = key.toUpperCase();
    } else {
      normalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
    }

    return [...modifiers, normalizedKey].join('+');
  }

  private async getOrCreateProofreaderService(
    language: string
  ): Promise<ReturnType<typeof createProofreadingService>> {
    const cacheKey = this.getLanguageCacheKey(language);
    if (this.proofreaderServices.has(cacheKey)) {
      return this.proofreaderServices.get(cacheKey)!;
    }

    logger.info(`Creating proofreader for language: ${language}`);
    const proofreader = await createProofreader({
      expectedInputLanguages: [language],
      includeCorrectionTypes: true,
      includeCorrectionExplanations: true,
      correctionExplanationLanguage: language,
    });
    const adapter = createProofreaderAdapter(proofreader);
    const service = createProofreadingService(adapter, undefined, {
      onBusyChange: (busy) => this.reportProofreaderBusy(busy),
    });
    this.proofreaderServices.set(cacheKey, service);
    return service;
  }

  private isEditableElement(element: HTMLElement): boolean {
    return shouldProofread(element);
  }

  private getElementText(element: HTMLElement): string {
    if (shouldMirrorOnElement(element)) {
      return (element as HTMLTextAreaElement | HTMLInputElement).value;
    }
    return element.textContent || '';
  }

  private reportIgnoredElement(element: HTMLElement, reason: ProofreadLifecycleReason): void {
    this.handleProofreadLifecycle({
      status: 'ignored',
      element,
      executionId: crypto.randomUUID(),
      textLength: this.getElementSnapshotText(element).length,
      reason,
    });
  }

  private handleProofreadLifecycle(event: ProofreadLifecycleInternalEvent): void {
    if (event.status === 'queued') {
      event.queueLength = this.proofreadQueue.size();
    }

    const elementId = this.getElementId(event.element);
    const elementKind = resolveElementKind(event.element);
    emitProofreadControlEvent({
      status: event.status,
      executionId: event.executionId,
      elementId,
      elementKind,
      textLength: event.textLength,
      correctionCount: event.correctionCount,
      detectedIssueCount: event.detectedIssueCount,
      reason: event.reason,
      error: event.error,
      queueLength: event.queueLength,
      debounceMs: event.debounceMs,
      forced: event.forced,
      language: event.language,
      fallbackLanguage: event.fallbackLanguage,
      timestamp: Date.now(),
    });
  }

  private getElementSnapshotText(element: HTMLElement): string {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    return element.textContent || '';
  }

  async proofreadActiveElement(): Promise<void> {
    if (!this.activeElement) {
      return;
    }

    await this.controller.proofread(this.activeElement);
  }

  destroy(): void {
    this.controller.dispose();

    this.highlighter.destroy();
    this.popover?.remove();
    this.observer?.disconnect();

    this.elementSessions.forEach((session) => session.detach());
    this.elementSessions.clear();
    this.elementCorrections.clear();
    this.elementLookup.clear();
    this.elementIssueLookup.clear();
    this.elementMessages.clear();

    this.proofreaderServices.forEach((service) => service.destroy());
    this.proofreaderServices.clear();

    this.languageDetectionService?.destroy();
    this.languageDetectionService = null;

    this.registeredElements.clear();
    this.proofreadQueue.clear();

    this.cleanupHandler(this.popoverHideCleanup);
    this.popoverHideCleanup = null;

    this.cleanupHandler(this.correctionTypeCleanup);
    this.correctionTypeCleanup = null;

    this.cleanupHandler(this.correctionColorsCleanup);
    this.correctionColorsCleanup = null;

    this.cleanupHandler(this.underlineStyleCleanup);
    this.underlineStyleCleanup = null;

    this.cleanupHandler(this.autoCorrectCleanup);
    this.autoCorrectCleanup = null;

    this.cleanupHandler(this.shortcutStorageCleanup);
    this.shortcutStorageCleanup = null;

    if (this.shortcutKeydownHandler) {
      document.removeEventListener('keydown', this.shortcutKeydownHandler, true);
      this.shortcutKeydownHandler = null;
    }
  }
}
