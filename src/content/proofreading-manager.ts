import { AsyncQueue } from '../shared/utils/queue.ts';
import { ContentHighlighter } from './components/content-highlighter.ts';
import { CanvasHighlighter } from './components/canvas-highlighter.ts';
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
import { STORAGE_KEYS } from '../shared/constants.ts';
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
import type { ProofreadCorrection, ProofreadResult } from '../shared/types.ts';

export class ProofreadingManager {
  private readonly highlighter = new ContentHighlighter();
  private readonly elementCanvasHighlighters = new Map<HTMLElement, CanvasHighlighter>();
  private readonly proofreaderServices = new Map<string, ReturnType<typeof createProofreadingService>>();
  private readonly proofreadQueue = new AsyncQueue();
  private readonly registeredElements = new Set<HTMLElement>();

  private sidebar: IssuesSidebar | null = null;
  private popover: CorrectionPopover | null = null;
  private popoverHideCleanup: (() => void) | null = null;
  private observer: MutationObserver | null = null;
  private activeElement: HTMLElement | null = null;
  private activeCanvasHighlighter: CanvasHighlighter | null = null;
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

  async initialize(): Promise<void> {
    await this.initializeLanguageDetection();
    this.createSidebar();
    this.createPopover();
    await this.initializeCorrectionPreferences();
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
        if (this.activeCanvasHighlighter) {
          this.activeCanvasHighlighter.clearSelection();
          this.activeCanvasHighlighter = null;
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
      this.controller.scheduleProofread(target);
    };

    const handleFocus = (event: Event) => {
      const target = event.target as HTMLElement;
      if (!this.isEditableElement(target)) {
        return;
      }
      this.activeElement = target;
      this.registerElement(target);
      void this.controller.proofread(target);
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
            void this.controller.proofread(element);
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
      this.ensureCanvasHighlighter(element as HTMLTextAreaElement | HTMLInputElement);
    } else {
      this.setupContentEditableCallbacks(element);
    }
  }

  private createTargetHooks(element: HTMLElement): ProofreadingTargetHooks {
    if (this.isTextareaOrInput(element)) {
      return {
        highlight: (corrections) => {
          this.highlightWithCanvas(element as HTMLTextAreaElement | HTMLInputElement, corrections);
        },
        clearHighlights: () => {
          this.clearCanvasHighlights(element as HTMLTextAreaElement | HTMLInputElement);
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

  private ensureCanvasHighlighter(element: HTMLTextAreaElement | HTMLInputElement): CanvasHighlighter {
    let canvasHighlighter = this.elementCanvasHighlighters.get(element);
    if (!canvasHighlighter) {
      canvasHighlighter = new CanvasHighlighter(element);
      canvasHighlighter.setCorrectionColors(this.correctionColors);
      canvasHighlighter.setOnCorrectionClick((correction, x, y) => {
        this.activeCanvasHighlighter = canvasHighlighter!;
        this.showPopoverForCorrection(element, correction, x, y);
      });
      this.elementCanvasHighlighters.set(element, canvasHighlighter);
    }
    return canvasHighlighter;
  }

  private highlightWithCanvas(
    element: HTMLTextAreaElement | HTMLInputElement,
    corrections: ProofreadCorrection[]
  ): void {
    const highlighter = this.ensureCanvasHighlighter(element);
    highlighter.drawHighlights(corrections);
  }

  private clearCanvasHighlights(element: HTMLTextAreaElement | HTMLInputElement): void {
    const highlighter = this.elementCanvasHighlighters.get(element);
    highlighter?.clearHighlights();
    if (this.activeCanvasHighlighter === highlighter) {
      this.activeCanvasHighlighter = null;
    }
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

    this.popover.show(x, y + 20);
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
    const { enabledCorrectionTypes, correctionColors } = await getStorageValues([
      STORAGE_KEYS.ENABLED_CORRECTION_TYPES,
      STORAGE_KEYS.CORRECTION_COLORS,
    ]);

    this.enabledCorrectionTypes = new Set(enabledCorrectionTypes);

    const colorConfig: CorrectionColorConfig = structuredClone(correctionColors);
    this.updateCorrectionColors(colorConfig);

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
  }

  private updateCorrectionColors(colorConfig: CorrectionColorConfig): void {
    this.correctionColors = buildCorrectionColorThemes(colorConfig);
    setActiveCorrectionColors(colorConfig);
    this.highlighter.setCorrectionColors(this.correctionColors);
    this.elementCanvasHighlighters.forEach((highlighter) => highlighter.setCorrectionColors(this.correctionColors));
  }

  private refreshCorrectionsForTrackedElements(): void {
    for (const element of this.registeredElements) {
      if (this.isEditableElement(element)) {
        void this.controller.proofread(element);
      }
    }
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

    this.elementCanvasHighlighters.forEach((highlighter) => highlighter.destroy());
    this.elementCanvasHighlighters.clear();

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
  }
}
