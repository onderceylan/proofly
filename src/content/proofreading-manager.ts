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
import './components/issues-sidebar.ts';
import type { IssuesSidebar, IssueItem } from './components/issues-sidebar.ts';
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
import { createProofreadingController } from '../shared/proofreading/controller.ts';
import type { ProofreadingTargetHooks } from '../shared/proofreading/types.ts';
import type {
  ProofreadCorrection,
  ProofreadResult,
  UnderlineStyle,
} from '../shared/types.ts';
import {
  TargetSession,
  type Issue as SessionIssue,
  type IssueColorPalette,
} from './target-session.ts';
import { isMacOS } from '../shared/utils/platform.ts';

export class ProofreadingManager {
  private readonly highlighter = new ContentHighlighter();
  private readonly elementSessions = new Map<HTMLElement, TargetSession>();
  private readonly elementIssueLookup = new Map<HTMLElement, Map<string, ProofreadCorrection>>();
  private readonly proofreaderServices = new Map<string, ReturnType<typeof createProofreadingService>>();
  private readonly proofreadQueue = new AsyncQueue();
  private readonly registeredElements = new Set<HTMLElement>();

  private sidebar: IssuesSidebar | null = null;
  private popover: CorrectionPopover | null = null;
  private popoverHideCleanup: (() => void) | null = null;
  private observer: MutationObserver | null = null;
  private activeElement: HTMLElement | null = null;
  private activeSessionElement: HTMLElement | null = null;
  private controller = createProofreadingController({
    runProofread: (element, text) => this.runProofread(element, text),
    filterCorrections: (_element, corrections, text) => this.filterCorrections(corrections, text),
    debounceMs: 1000,
    getElementText: (element) => this.getElementText(element),
  });
  private languageDetectionService: ReturnType<typeof createLanguageDetectionService> | null = null;
  private enabledCorrectionTypes = new Set<CorrectionTypeKey>();
  private correctionTypeCleanup: (() => void) | null = null;
  private correctionColors: CorrectionColorThemeMap = getActiveCorrectionColors();
  private correctionColorsCleanup: (() => void) | null = null;
  private underlineStyle: UnderlineStyle = STORAGE_DEFAULTS[STORAGE_KEYS.UNDERLINE_STYLE] as UnderlineStyle;
  private underlineStyleCleanup: (() => void) | null = null;
  private autoCorrectEnabled: boolean = STORAGE_DEFAULTS[STORAGE_KEYS.AUTO_CORRECT] as boolean;
  private proofreadShortcut: string = STORAGE_DEFAULTS[STORAGE_KEYS.PROOFREAD_SHORTCUT] as string;
  private autofixOnDoubleClick: boolean = STORAGE_DEFAULTS[STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK] as boolean;
  private autoCorrectCleanup: (() => void) | null = null;
  private shortcutStorageCleanup: (() => void) | null = null;
  private autofixCleanup: (() => void) | null = null;
  private shortcutKeydownHandler: ((event: KeyboardEvent) => void) | null = null;
  private readonly isMacPlatform = isMacOS();

  async initialize(): Promise<void> {
    await this.initializeLanguageDetection();
    this.createSidebar();
    this.createPopover();
    await this.initializeCorrectionPreferences();
    await this.initializeProofreadPreferences();
    this.observeEditableElements();
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

  private createSidebar(): void {
    if (document.querySelector('proofly-issues-sidebar')) {
      this.sidebar = document.querySelector('proofly-issues-sidebar') as IssuesSidebar;
    } else {
      this.sidebar = document.createElement('proofly-issues-sidebar') as IssuesSidebar;
      document.body.appendChild(this.sidebar);
    }

    this.sidebar.onApply((issue: IssueItem) => {
      this.applyCorrection(issue);
    });
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
      const target = event.target as HTMLElement;
      if (!this.isEditableElement(target)) {
        return;
      }
      this.registerElement(target);
      if (this.isTextareaOrInput(target)) {
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
    };

    const handleBlur = (event: Event) => {
      const target = event.target as HTMLElement;
      if (this.activeElement === target) {
        this.activeElement = null;
        this.sidebar?.setIssues([]);
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

    const hooks = this.createTargetHooks(element);
    this.controller.registerTarget({ element, hooks });

    if (this.isTextareaOrInput(element)) {
      this.ensureTargetSession(element as HTMLTextAreaElement | HTMLInputElement);
    } else {
      this.setupContentEditableCallbacks(element);
    }
  }

  private createTargetHooks(element: HTMLElement): ProofreadingTargetHooks {
    if (this.isTextareaOrInput(element)) {
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
        },
        onInvalidateIssues: () => {
          this.clearSessionHighlights(element);
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

  private clearSessionHighlights(element: HTMLTextAreaElement | HTMLInputElement): void {
    const session = this.elementSessions.get(element);
    session?.setIssues([]);
    session?.clearActiveIssue();
    this.elementIssueLookup.delete(element);
    if (this.activeSessionElement === element) {
      this.activeSessionElement = null;
    }
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
    });
  }

  private handleCorrectionsChange(element: HTMLElement, corrections: ProofreadCorrection[]): void {
    if (this.activeElement === element) {
      this.updateSidebar(element, corrections);
    }
  }

  private async runProofread(_element: HTMLElement, text: string): Promise<ProofreadResult | null> {
    return this.proofreadQueue.enqueue(async () => {
      let detectedLanguage: string | null = null;

      if (this.languageDetectionService) {
        try {
          detectedLanguage = await this.languageDetectionService.detectLanguage(text);
        } catch (error) {
          logger.warn({ error }, 'Language detection failed, falling back to English');
          detectedLanguage = null;
        }
      }

      const language = detectedLanguage || 'en';
      const service = await this.getOrCreateProofreaderService(language);
      if (!service.canProofread(text)) {
        return null;
      }

      return service.proofread(text);
    });
  }

  private filterCorrections(corrections: ProofreadCorrection[], text: string): ProofreadCorrection[] {
    const trimmedLength = text.trimEnd().length;
    return corrections
      .filter((correction) => correction.startIndex < trimmedLength)
      .filter((correction) => this.isCorrectionEnabled(correction));
  }

  private handleCorrectionFromPopover(element: HTMLElement, correction: ProofreadCorrection): void {
    this.controller.applyCorrection(element, correction);
  }

  private applyCorrection(issue: IssueItem): void {
    this.controller.applyCorrection(issue.element, issue.correction);
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

    this.popover.setCorrection(correction, (applied) => {
      this.handleCorrectionFromPopover(element, applied);
    });

    this.popover.show(x, y);
  }

  private updateSidebar(element: HTMLElement, corrections: ProofreadCorrection[]): void {
    if (!this.sidebar) {
      return;
    }

    if (this.activeElement !== element) {
      return;
    }

    if (corrections.length === 0) {
      this.sidebar.setIssues([]);
      return;
    }

    const issues: IssueItem[] = corrections.map((correction, index) => ({
      element,
      correction,
      index,
    }));

    this.sidebar.setIssues(issues);
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
    this.correctionColorsCleanup = onStorageChange(
      STORAGE_KEYS.CORRECTION_COLORS,
      (newValue) => {
        const updatedConfig: CorrectionColorConfig = structuredClone(newValue);
        this.updateCorrectionColors(updatedConfig);
        this.refreshCorrectionsForTrackedElements();
      }
    );

    this.cleanupHandler(this.underlineStyleCleanup);
    this.underlineStyleCleanup = onStorageChange(
      STORAGE_KEYS.UNDERLINE_STYLE,
      (newValue) => {
        this.updateUnderlineStyle(newValue);
      }
    );
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
    this.autoCorrectCleanup = onStorageChange(
      STORAGE_KEYS.AUTO_CORRECT,
      (newValue) => {
        this.autoCorrectEnabled = newValue;
        if (!newValue) {
          this.controller.cancelPendingProofreads();
        }
        if (newValue && this.activeElement) {
          void this.controller.proofread(this.activeElement, { force: true });
        }
      }
    );

    this.cleanupHandler(this.shortcutStorageCleanup);
    this.shortcutStorageCleanup = onStorageChange(
      STORAGE_KEYS.PROOFREAD_SHORTCUT,
      (newValue) => {
        this.proofreadShortcut = newValue;
      }
    );

    this.cleanupHandler(this.autofixCleanup);
    this.autofixCleanup = onStorageChange(
      STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK,
      (newValue) => {
        this.updateAutofixOnDoubleClick(newValue);
      }
    );
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

  private async getOrCreateProofreaderService(language: string): Promise<ReturnType<typeof createProofreadingService>> {
    if (this.proofreaderServices.has(language)) {
      return this.proofreaderServices.get(language)!;
    }

    logger.info(`Creating proofreader for language: ${language}`);
    const proofreader = await createProofreader({
      expectedInputLanguages: [language],
      includeCorrectionTypes: true,
      includeCorrectionExplanations: true,
      correctionExplanationLanguage: language,
    });
    const adapter = createProofreaderAdapter(proofreader);
    const service = createProofreadingService(adapter);
    this.proofreaderServices.set(language, service);
    return service;
  }

  private isEditableElement(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'textarea') {
      return true;
    }

    if (tagName === 'input') {
      const inputType = (element as HTMLInputElement).type;
      return !inputType || ['text', 'email', 'search', 'url'].includes(inputType);
    }

    return element.isContentEditable || element.hasAttribute('contenteditable');
  }

  private isTextareaOrInput(element: HTMLElement): element is HTMLTextAreaElement | HTMLInputElement {
    const tagName = element.tagName.toLowerCase();
    return tagName === 'textarea' || tagName === 'input';
  }

  private getElementText(element: HTMLElement): string {
    if (this.isTextareaOrInput(element)) {
      return (element as HTMLTextAreaElement | HTMLInputElement).value;
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
    this.sidebar?.remove();
    this.popover?.remove();
    this.observer?.disconnect();

    this.elementSessions.forEach((session) => session.detach());
    this.elementSessions.clear();
    this.elementIssueLookup.clear();

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
