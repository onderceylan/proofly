import { ContentHighlighter } from './components/content-highlighter.ts';
import './components/correction-popover.ts';
import { logger } from '../services/logger.ts';
import { getSelectionRangeFromElement } from '../shared/proofreading/controller.ts';
import { shouldMirrorOnElement } from '../shared/proofreading/target-selectors.ts';
import type { ProofreadCorrection } from '../shared/types.ts';
import { createUniqueId } from './utils.ts';
import { isMacOS } from '../shared/utils/platform.ts';
import {
  emitProofreadControlEvent,
  type ProofreadLifecycleReason,
} from '../shared/proofreading/control-events.ts';
import type { TargetHandler } from './handlers/target-handler.ts';
import { MirrorTargetHandler } from './handlers/mirror-target-handler.ts';
import { DirectTargetHandler } from './handlers/direct-target-handler.ts';
import { ElementTracker } from './services/element-tracker.ts';
import { PopoverManager } from './services/popover-manager.ts';
import { PreferenceManager } from './services/preference-manager.ts';
import { IssueManager } from './services/issue-manager.ts';
import { ContentProofreadingService } from './services/content-proofreading-service.ts';
import { resolveElementKind } from '../shared/messages/issues.ts';

export class ProofreadingManager {
  private readonly highlighter = new ContentHighlighter();
  private readonly targetHandlers = new Map<HTMLElement, TargetHandler>();
  private readonly pageId = createUniqueId('page');
  private activeSessionElement: HTMLElement | null = null;
  private shortcutKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private readonly isMacPlatform = isMacOS();

  // Services
  private readonly elementTracker: ElementTracker;
  private readonly popoverManager: PopoverManager;
  private readonly preferenceManager: PreferenceManager;
  private readonly issueManager: IssueManager;
  private readonly proofreadingService: ContentProofreadingService;

  constructor() {
    this.elementTracker = new ElementTracker({
      onElementAdded: (element) => this.handleElementAdded(element),
      onElementRemoved: (element) => this.handleElementRemoved(element),
      onElementFocused: (element) => this.handleElementFocused(element),
      onElementBlurred: (element) => this.handleElementBlurred(element),
      onElementInput: (element) => this.handleElementInput(element),
    });

    this.popoverManager = new PopoverManager({
      highlighter: this.highlighter,
      onCorrectionApplied: (element, correction) =>
        this.handleCorrectionFromPopover(element, correction),
      onPopoverHide: () => this.handlePopoverHide(),
    });

    this.preferenceManager = new PreferenceManager({
      onCorrectionTypesChanged: () => this.refreshCorrectionsForTrackedElements(),
      onCorrectionColorsChanged: (colors, palette) => {
        this.highlighter.setCorrectionColors(colors);
        this.targetHandlers.forEach((handler) =>
          handler.updatePreferences({ colorPalette: palette })
        );
      },
      onUnderlineStyleChanged: (style) => {
        this.targetHandlers.forEach((handler) =>
          handler.updatePreferences({ underlineStyle: style })
        );
      },
      onAutoCorrectChanged: (enabled) => {
        if (!enabled) {
          this.proofreadingService.cancelPendingProofreads();
        }
        const activeElement = this.elementTracker.getActiveElement();
        if (enabled && activeElement) {
          void this.proofreadingService.proofread(activeElement, { force: true });
        }
      },
      onAutofixOnDoubleClickChanged: (enabled) => {
        this.targetHandlers.forEach((handler) =>
          handler.updatePreferences({ autofixOnDoubleClick: enabled })
        );
        this.popoverManager.setAutofixOnDoubleClick(enabled);
        this.popoverManager.updateVisibility(this.issueManager.hasCorrections());
      },
    });

    this.issueManager = new IssueManager({
      pageId: this.pageId,
      getElementId: (element) => this.elementTracker.getElementId(element),
      getElementText: (element) => this.getElementText(element),
      getActiveElement: () => this.elementTracker.getActiveElement(),
    });

    this.proofreadingService = new ContentProofreadingService({
      debounceMs: 1000,
      getElementText: (element) => this.getElementText(element),
      filterCorrections: (corrections, text) => this.filterCorrections(corrections, text),
      onLifecycleEvent: (event) => this.handleProofreadLifecycle(event),
      onMessage: (element, message) => this.issueManager.setMessage(element, message),
      onClearMessage: (element, code) => this.issueManager.clearMessage(element, code),
    });
  }

  async initialize(): Promise<void> {
    await this.proofreadingService.initialize();
    await this.preferenceManager.initialize();
    this.elementTracker.initialize();
    this.setupShortcutListener();
    this.issueManager.emitIssuesUpdate();
    this.popoverManager.updateVisibility(false);
    logger.info('Proofreading manager ready');
  }

  destroy(): void {
    this.proofreadingService.destroy();
    this.preferenceManager.destroy();
    this.elementTracker.destroy();
    this.popoverManager.destroy();
    this.highlighter.destroy();

    this.targetHandlers.forEach((handler) => handler.dispose());
    this.targetHandlers.clear();

    if (this.shortcutKeydownHandler) {
      document.removeEventListener('keydown', this.shortcutKeydownHandler, true);
      this.shortcutKeydownHandler = null;
    }
  }

  applyIssue(elementId: string, issueId: string): void {
    const element = this.elementTracker.getElementById(elementId);
    if (!element) {
      logger.warn({ elementId, issueId }, 'Issue apply requested for unknown element');
      return;
    }

    const correction = this.issueManager.getCorrection(element, issueId);
    if (!correction) {
      logger.warn({ elementId, issueId }, 'Missing correction for requested issue');
      return;
    }

    this.proofreadingService.applyCorrection(element, correction);
    this.issueManager.scheduleIssuesUpdate();
  }

  applyAllIssues(): void {
    const elements = Array.from(this.targetHandlers.keys());
    if (elements.length === 0) {
      logger.info('Fix all requested but no issues are available');
      return;
    }

    try {
      for (const element of elements) {
        if (!element) {
          continue;
        }

        let safetyCounter = 0;
        while (true) {
          const corrections = this.proofreadingService.getCorrections(element);
          if (!corrections || corrections.length === 0) {
            break;
          }

          const [nextCorrection] = corrections;
          this.proofreadingService.applyCorrection(element, nextCorrection);
          safetyCounter += 1;

          if (safetyCounter > 1000) {
            logger.warn({ element }, 'Stopping bulk apply due to iteration safety limit');
            break;
          }
        }
      }

      this.issueManager.scheduleIssuesUpdate();
      logger.info('Applied all outstanding issues');
    } finally {
      // Busy state is managed by ContentProofreadingService
    }
  }

  async proofreadActiveElement(): Promise<void> {
    const activeElement = this.elementTracker.getActiveElement();
    if (!activeElement) {
      return;
    }

    const selection = this.getSelectionRange(activeElement);

    await this.proofreadingService.proofread(activeElement, {
      force: true,
      selection: selection ?? undefined,
    });
  }

  private handleElementAdded(element: HTMLElement): void {
    if (!this.preferenceManager.isAutoCorrectEnabled()) {
      return;
    }

    if (!this.elementTracker.shouldAutoProofread(element)) {
      const reason = this.elementTracker.resolveAutoProofreadIgnoreReason(element);
      this.reportIgnoredElement(element, reason);
      return;
    }

    this.registerElement(element);
    void this.proofreadingService.proofread(element);
  }

  private handleElementRemoved(element: HTMLElement): void {
    this.cleanupRemovedElement(element);
  }

  private handleElementFocused(element: HTMLElement): void {
    if (!this.elementTracker.isProofreadTarget(element)) {
      return;
    }

    this.registerElement(element);

    if (this.preferenceManager.isAutoCorrectEnabled()) {
      if (!this.elementTracker.shouldAutoProofread(element)) {
        const reason = this.elementTracker.resolveAutoProofreadIgnoreReason(element);
        this.reportIgnoredElement(element, reason);
        this.elementTracker.unregisterElement(element);
        return;
      }

      void this.proofreadingService.proofread(element);
      this.issueManager.emitIssuesUpdate();
    }
  }

  private handleElementBlurred(_element: HTMLElement): void {
    // Currently no action needed on blur
  }

  private handleElementInput(element: HTMLElement): void {
    if (!this.elementTracker.isProofreadTarget(element)) {
      this.reportIgnoredElement(element, 'unsupported-target');
      return;
    }
    if (!this.preferenceManager.isAutoCorrectEnabled()) {
      return;
    }
    if (!this.elementTracker.shouldAutoProofread(element)) {
      const reason = this.elementTracker.resolveAutoProofreadIgnoreReason(element);
      this.reportIgnoredElement(element, reason);
      return;
    }
    this.issueManager.clearMessage(element);
    this.registerElement(element);
    this.proofreadingService.scheduleProofread(element);
  }

  private registerElement(element: HTMLElement): void {
    if (this.elementTracker.isRegistered(element)) {
      return;
    }

    this.elementTracker.registerElement(element);

    const hooks = this.createTargetHooks(element);
    this.proofreadingService.registerTarget({ element, hooks });

    this.ensureTargetHandler(element);
  }

  private cleanupRemovedElement(element: HTMLElement): void {
    if (!this.elementTracker.isRegistered(element)) {
      return;
    }

    this.elementTracker.unregisterElement(element);

    if (this.activeSessionElement === element) {
      this.activeSessionElement = null;
    }

    const handler = this.targetHandlers.get(element);
    if (handler) {
      handler.dispose();
      this.targetHandlers.delete(element);
    }

    this.issueManager.clearState(element);
    this.popoverManager.updateVisibility(this.issueManager.hasCorrections());

    this.proofreadingService.unregisterTarget(element);

    logger.info(
      { elementId: this.elementTracker.getElementId(element) },
      'Cleaned up removed element'
    );

    this.issueManager.scheduleIssuesUpdate();
  }

  private createTargetHooks(element: HTMLElement) {
    return {
      highlight: (corrections: ProofreadCorrection[]) => {
        this.handleCorrectionsChange(element, corrections);
        const handler = this.targetHandlers.get(element);
        handler?.highlight(corrections);
      },
      clearHighlights: () => {
        const handler = this.targetHandlers.get(element);
        handler?.clearHighlights();
        this.clearElementState(element);
      },
      onCorrectionsChange: (corrections: ProofreadCorrection[]) => {
        this.handleCorrectionsChange(element, corrections);
      },
    };
  }

  private ensureTargetHandler(element: HTMLElement): void {
    if (this.targetHandlers.has(element)) {
      return;
    }

    let handler: TargetHandler;

    if (shouldMirrorOnElement(element)) {
      handler = new MirrorTargetHandler(element as HTMLTextAreaElement | HTMLInputElement, {
        onNeedProofread: () => {
          if (!this.preferenceManager.isAutoCorrectEnabled()) {
            return;
          }
          if (!this.elementTracker.shouldAutoProofread(element)) {
            const reason = this.elementTracker.resolveAutoProofreadIgnoreReason(element);
            this.reportIgnoredElement(element, reason);
            return;
          }
          void this.proofreadingService.proofread(element);
        },
        onUnderlineClick: (issueId, pageRect, anchorNode) => {
          this.activeSessionElement = element;
          const correction = this.issueManager.getCorrection(element, issueId);
          if (!correction) {
            return;
          }
          const anchorX = pageRect.left + pageRect.width / 2;
          const anchorY = pageRect.top + pageRect.height;
          const positionResolver = anchorNode
            ? () => {
                if (!anchorNode.isConnected) {
                  return null;
                }
                const rect = anchorNode.getBoundingClientRect();
                return {
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height,
                };
              }
            : undefined;
          this.showPopoverForCorrection(element, correction, anchorX, anchorY, positionResolver);
        },
        onUnderlineDoubleClick: (issueId) => {
          const correction = this.issueManager.getCorrection(element, issueId);
          if (!correction) {
            return;
          }
          this.proofreadingService.applyCorrection(element, correction);
          this.issueManager.scheduleIssuesUpdate();
        },
        onInvalidateIssues: () => {
          if (!this.proofreadingService.isRestoringFromHistory(element)) {
            const handler = this.targetHandlers.get(element);
            handler?.clearHighlights();
            this.clearElementState(element, { silent: true });
          }
        },
        initialPalette: this.preferenceManager.buildIssuePalette(),
        initialUnderlineStyle: this.preferenceManager.getUnderlineStyle(),
        initialAutofixOnDoubleClick: this.preferenceManager.isAutofixOnDoubleClickEnabled(),
      });
    } else {
      handler = new DirectTargetHandler(element, {
        highlighter: this.highlighter,
        onCorrectionApplied: (updatedCorrections) => {
          this.handleCorrectionsChange(element, updatedCorrections);
        },
        onApplyCorrection: (correction) => {
          this.proofreadingService.applyCorrection(element, correction);
          this.issueManager.scheduleIssuesUpdate();
        },
      });
    }

    handler.attach();
    this.targetHandlers.set(element, handler);
  }

  private clearElementState(element: HTMLElement, options: { silent?: boolean } = {}): void {
    const hadCorrections = this.issueManager.getCorrections(element).length > 0;

    if (options.silent) {
      if (this.activeSessionElement === element) {
        this.activeSessionElement = null;
      }
      if (hadCorrections) {
        this.issueManager.clearState(element);
        this.issueManager.scheduleIssuesUpdate(true);
        this.popoverManager.updateVisibility(this.issueManager.hasCorrections());
      }
      return;
    }

    this.issueManager.clearState(element);
    if (this.activeSessionElement === element) {
      this.activeSessionElement = null;
    }
    this.issueManager.emitIssuesUpdate();
    this.popoverManager.updateVisibility(this.issueManager.hasCorrections());
  }

  private handleCorrectionsChange(element: HTMLElement, corrections: ProofreadCorrection[]): void {
    this.issueManager.setCorrections(element, corrections);
    this.issueManager.scheduleIssuesUpdate(corrections.length === 0);
    this.popoverManager.updateVisibility(this.issueManager.hasCorrections());
  }

  private filterCorrections(
    corrections: ProofreadCorrection[],
    text: string
  ): ProofreadCorrection[] {
    const trimmedLength = text.trimEnd().length;
    const enabledTypes = this.preferenceManager.getEnabledCorrectionTypes();

    return corrections
      .filter((correction) => correction.startIndex < trimmedLength)
      .filter((correction) => {
        if (enabledTypes.size === 0) {
          return false;
        }
        if (!correction.type) {
          return true;
        }
        return enabledTypes.has(correction.type as any);
      });
  }

  private handleCorrectionFromPopover(element: HTMLElement, correction: ProofreadCorrection): void {
    this.proofreadingService.applyCorrection(element, correction);
    this.issueManager.scheduleIssuesUpdate();
  }

  private showPopoverForCorrection(
    element: HTMLElement,
    correction: ProofreadCorrection,
    x: number,
    y: number,
    positionResolver?: () => { x: number; y: number } | null
  ): void {
    const elementText = this.getElementText(element);
    const issueText = elementText.substring(correction.startIndex, correction.endIndex);
    this.popoverManager.show(element, correction, issueText, x, y, positionResolver);
  }

  private handlePopoverHide(): void {
    this.highlighter.clearSelection();
    if (this.activeSessionElement) {
      const handler = this.targetHandlers.get(this.activeSessionElement);
      handler?.clearSelection();
      this.activeSessionElement = null;
    }
  }

  private refreshCorrectionsForTrackedElements(): void {
    for (const element of this.targetHandlers.keys()) {
      if (this.elementTracker.shouldAutoProofread(element)) {
        void this.proofreadingService.proofread(element);
      }
    }
  }

  private setupShortcutListener(): void {
    if (this.shortcutKeydownHandler) {
      return;
    }

    this.shortcutKeydownHandler = (event: KeyboardEvent) => {
      if (!this.matchesShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const activeElement = this.elementTracker.getActiveElement();
      if (activeElement) {
        void this.proofreadActiveElement();
      } else {
        void this.proofreadingService.proofread(event.target as HTMLElement);
      }
    };

    document.addEventListener('keydown', this.shortcutKeydownHandler, true);
  }

  private matchesShortcut(event: KeyboardEvent): boolean {
    const shortcut = this.preferenceManager.getProofreadShortcut();
    if (!shortcut) {
      return false;
    }

    const combo = this.buildShortcutFromEvent(event);
    return combo !== null && combo === shortcut;
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

  private getElementText(element: HTMLElement): string {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    return element.textContent || '';
  }

  private reportIgnoredElement(element: HTMLElement, reason: ProofreadLifecycleReason): void {
    this.handleProofreadLifecycle({
      status: 'ignored',
      element,
      executionId: createUniqueId('proofread'),
      textLength: this.getElementText(element).length,
      reason,
    });
  }

  private handleProofreadLifecycle(event: any): void {
    const elementId = this.elementTracker.getElementId(event.element);
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

  private getSelectionRange(element: HTMLElement) {
    return getSelectionRangeFromElement(element, (root, node, offset) =>
      this.getTextOffsetWithin(root, node, offset)
    );
  }

  private getTextOffsetWithin(root: HTMLElement, node: Node, offset: number): number {
    const range = document.createRange();
    range.setStart(root, 0);
    try {
      range.setEnd(node, offset);
    } catch {
      return 0;
    }
    return range.toString().length;
  }
}
