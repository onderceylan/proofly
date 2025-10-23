import { debounce } from '../shared/utils/debounce.ts';
import { AsyncQueue } from '../shared/utils/queue.ts';
import { ContentHighlighter } from './components/content-highlighter.ts';
import { CanvasHighlighter } from './components/canvas-highlighter.ts';
import {
  createProofreader,
  createProofreaderAdapter,
  createProofreadingService,
} from '../services/proofreader.ts';
import './components/issues-sidebar.ts';
import type { IssuesSidebar, IssueItem } from './components/issues-sidebar.ts';
import './components/correction-popover.ts';
import type { CorrectionPopover } from './components/correction-popover.ts';
import { logger } from "../services/logger.ts";
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

export class ProofreadingManager {
  private highlighter = new ContentHighlighter();
  private sidebar: IssuesSidebar | null = null;
  private popover: CorrectionPopover | null = null;
  private activeElement: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private elementCorrections = new Map<HTMLElement, ProofreadCorrection[]>();
  private elementCanvasHighlighters = new Map<HTMLElement, CanvasHighlighter>();
  private proofreaderService: ReturnType<typeof createProofreadingService> | null = null;
  private elementPreviousText = new Map<HTMLElement, string>();
  private isApplyingCorrection = false;
  private debouncedProofread: ((element: HTMLElement) => void) | null = null;
  private activeCanvasHighlighter: CanvasHighlighter | null = null;
  private popoverHideCleanup: (() => void) | null = null;
  private enabledCorrectionTypes = new Set<CorrectionTypeKey>();
  private correctionTypeCleanup: (() => void) | null = null;
  private correctionColors: CorrectionColorThemeMap = getActiveCorrectionColors();
  private correctionColorsCleanup: (() => void) | null = null;
  private proofreadQueue = new AsyncQueue();

  async initialize(): Promise<void> {
    // Initialize proofreader service
    try {
      logger.info('Starting proofreader initialization');
      const proofreader = await createProofreader();
      logger.info('Proofreader created');
      const adapter = createProofreaderAdapter(proofreader);
      this.proofreaderService = createProofreadingService(adapter);
      logger.info('Proofreader service initialized successfully');
    } catch (error) {
      logger.error({error}, 'Failed to initialize proofreader');
      return;
    }

    logger.info('Setting up event listeners');
    this.createSidebar();
    this.createPopover();
    this.setupContextMenuHandler();
    this.observeEditableElements();
    await this.initializeCorrectionPreferences();
    logger.info('Event listeners set up - ready for input!');
  }

  private createSidebar(): void {
    if (document.querySelector('proofly-issues-sidebar')) return;

    this.sidebar = document.createElement('proofly-issues-sidebar') as IssuesSidebar;
    document.body.appendChild(this.sidebar);

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

  private setupContextMenuHandler(): void {
    document.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      if (this.isEditableElement(target)) {
        this.activeElement = target;
      }
    });
  }

  private getCursorPosition(element: HTMLElement): number | null {
    if (this.isTextareaOrInput(element)) {
      const input = element as HTMLTextAreaElement | HTMLInputElement;
      return input.selectionStart;
    }
    return null;
  }

  private clearHighlightsAfterCursor(element: HTMLElement): void {
    const cursorPosition = this.getCursorPosition(element);
    if (cursorPosition === null) return;

    const corrections = this.elementCorrections.get(element);
    if (!corrections || corrections.length === 0) return;

    const validCorrections = corrections.filter(correction => correction.endIndex < cursorPosition);

    if (validCorrections.length === 0) {
      this.clearElementHighlights(element);
      this.sidebar?.setIssues([]);
    } else if (validCorrections.length < corrections.length) {
      this.elementCorrections.set(element, validCorrections);
      this.rehighlightElement(element, validCorrections);
      this.updateSidebar(element, validCorrections);
    }
  }

  private isOnlyTrailingSpaceAdded(element: HTMLElement, currentText: string): boolean {
    const previousText = this.elementPreviousText.get(element) || '';

    if (currentText.length <= previousText.length) {
      return false;
    }

    const trimmedCurrent = currentText.trimEnd();
    const trimmedPrevious = previousText.trimEnd();

    return trimmedCurrent === trimmedPrevious && currentText !== trimmedCurrent;
  }

  private observeEditableElements(): void {
    this.debouncedProofread = debounce((element: HTMLElement) => {
      void this.proofreadElement(element);
    }, 1500);

    const handleInput = (e: Event) => {
      const target = e.target as HTMLElement;
      if (this.isEditableElement(target)) {
        if (this.isApplyingCorrection) {
          return;
        }

        const currentText = this.getElementText(target);

        this.clearHighlightsAfterCursor(target);

        if (!this.isOnlyTrailingSpaceAdded(target, currentText)) {
          this.debouncedProofread?.(target);
        }

        this.elementPreviousText.set(target, currentText);
      }
    };

    document.addEventListener('input', handleInput, true);

    const handleFocus = (e: Event) => {
      const target = e.target as HTMLElement;
      if (this.isEditableElement(target)) {
        const text = this.getElementText(target);
        if (text && text.trim().length > 0) {
          // Check if element has been proofread before
          const hasCorrections = this.elementCorrections.has(target);
          const hasPreviousText = this.elementPreviousText.has(target);

          // Trigger immediate proofreading for pre-filled text (no debounce)
          if (!hasCorrections && !hasPreviousText) {
            void this.proofreadElement(target);
            this.elementPreviousText.set(target, text);
          }
        }
      }
    };

    document.addEventListener('focus', handleFocus, true);

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as HTMLElement;
              if (this.isEditableElement(element)) {
                const text = this.getElementText(element);
                if (text && text.length > 10) {
                  // Proofread immediately for dynamically added elements with existing text
                  void this.proofreadElement(element);
                }
              }
            }
          });
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async proofreadElement(element: HTMLElement): Promise<void> {
    if (!this.proofreaderService) {
      return;
    }

    const text = this.getElementText(element);
    if (!text || !this.proofreaderService.canProofread(text)) {
      this.clearElementHighlights(element);
      return;
    }

    this.elementPreviousText.set(element, text);

    // Queue the proofreading operation to avoid race conditions
    // when multiple elements trigger proofreading simultaneously
    await this.proofreadQueue.enqueue(async () => {
      try {
        const result = await this.proofreaderService!.proofread(text);

        const currentText = this.getElementText(element);
        if (currentText !== text) {
          logger.info('Text changed during proofreading, discarding stale results');
          return;
        }

        if (result.corrections && result.corrections.length > 0) {
          const trimmedLength = text.trimEnd().length;
          const trimmedCorrections = result.corrections.filter(correction =>
            correction.startIndex < trimmedLength
          );

          const filteredCorrections = trimmedCorrections.filter((correction) => this.isCorrectionEnabled(correction));

          if (filteredCorrections.length === 0) {
            this.clearElementHighlights(element);
            this.sidebar?.setIssues([]);
            return;
          }

          this.elementCorrections.set(element, filteredCorrections);

          // Highlight the corrections
          this.rehighlightElement(element, filteredCorrections);
          this.updateSidebar(element, filteredCorrections);

          // Setup callback for when corrections are applied via clicking highlights
          this.highlighter.setOnCorrectionApplied(element, (updatedCorrections) => {
            this.elementCorrections.set(element, updatedCorrections);
            this.updateSidebar(element, updatedCorrections);
          });

          // Setup callback to actually apply the correction text
          this.highlighter.setApplyCorrectionCallback(element, (_clickedElement, correction) => {
            this.handleCorrectionFromPopover(element, correction);
          });

          logger.info(`Found ${filteredCorrections.length} corrections for element`);
        } else {
          this.clearElementHighlights(element);
        }
      } catch (error) {
        logger.error({ error }, 'Proofreading failed');
      }
    });
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
    const elements = new Set<HTMLElement>();

    this.elementCorrections.forEach((_value, key) => {
      elements.add(key);
    });

    this.elementPreviousText.forEach((_value, key) => {
      elements.add(key);
    });

    if (this.activeElement) {
      elements.add(this.activeElement);
    }

    elements.forEach((element) => {
      if (this.isEditableElement(element)) {
        void this.proofreadElement(element);
      }
    });
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

  private highlightWithCanvas(element: HTMLTextAreaElement | HTMLInputElement, corrections: ProofreadCorrection[]): void {
    // Create or reuse canvas highlighter for this element
    let canvasHighlighter = this.elementCanvasHighlighters.get(element);

    if (!canvasHighlighter) {
      canvasHighlighter = new CanvasHighlighter(element);
      this.elementCanvasHighlighters.set(element, canvasHighlighter);

      const highlighterInstance = canvasHighlighter;
      // Setup click handler for popover
      canvasHighlighter.setOnCorrectionClick((correction, x, y) => {
        this.activeCanvasHighlighter = highlighterInstance;
        this.showPopoverForCorrection(element, correction, x, y);
      });
      canvasHighlighter.setCorrectionColors(this.correctionColors);
    }

    // Draw highlights on canvas
    canvasHighlighter.drawHighlights(corrections);
  }

  private showPopoverForCorrection(element: HTMLElement, correction: ProofreadCorrection, x: number, y: number): void {
    if (!this.popover) return;

    this.popover.setCorrection(correction, (appliedCorrection) => {
      this.handleCorrectionFromPopover(element, appliedCorrection);
    });

    this.popover.show(x, y + 20); // Show below the click point
  }

  private rehighlightElement(element: HTMLElement, corrections: ProofreadCorrection[]): void {
    if (this.isTextareaOrInput(element)) {
      this.highlightWithCanvas(element as HTMLTextAreaElement | HTMLInputElement, corrections);
    } else {
      this.highlighter.highlight(element, corrections);
    }
  }

  private updateCorrectionsAfterApply(
    element: HTMLElement,
    appliedCorrection: ProofreadCorrection
  ): ProofreadCorrection[] | null {
    const corrections = this.elementCorrections.get(element);
    if (!corrections) return null;

    const lengthDiff = appliedCorrection.correction.length - (appliedCorrection.endIndex - appliedCorrection.startIndex);

    return corrections
      .filter(c => c !== appliedCorrection)
      .map(c => {
        if (c.startIndex > appliedCorrection.startIndex) {
          return {
            ...c,
            startIndex: c.startIndex + lengthDiff,
            endIndex: c.endIndex + lengthDiff
          };
        }
        return c;
      });
  }

  private applyCorrectionToElement(element: HTMLElement, correction: ProofreadCorrection): void {
    const text = this.getElementText(element);
    if (!text) return;

    // Apply the correction
    if (this.isTextareaOrInput(element)) {
      this.applyCorrectionWithUndo(element as HTMLTextAreaElement | HTMLInputElement, correction);
    } else {
      const newText =
        text.substring(0, correction.startIndex) +
        correction.correction +
        text.substring(correction.endIndex);
      this.setElementText(element, newText);
    }

    // Update tracked text
    const newText = this.getElementText(element);
    this.elementPreviousText.set(element, newText);

    // Update remaining corrections
    const updatedCorrections = this.updateCorrectionsAfterApply(element, correction);
    if (updatedCorrections !== null) {
      this.elementCorrections.set(element, updatedCorrections);

      if (updatedCorrections.length > 0) {
        this.rehighlightElement(element, updatedCorrections);
        this.updateSidebar(element, updatedCorrections);
      } else {
        this.clearElementHighlights(element);
        this.sidebar?.setIssues([]);
      }
    }

    // Trigger re-proofreading
    this.debouncedProofread?.(element);
  }

  private clearElementHighlights(element: HTMLElement): void {
    // Clear canvas highlights for textarea/input
    if (this.isTextareaOrInput(element)) {
      const canvasHighlighter = this.elementCanvasHighlighters.get(element);
      if (canvasHighlighter) {
        canvasHighlighter.clearHighlights();
        if (this.activeCanvasHighlighter === canvasHighlighter) {
          this.activeCanvasHighlighter = null;
        }
      }
    } else {
      // Clear DOM highlights for contenteditable
      this.highlighter.clearHighlights(element);
    }
    this.elementCorrections.delete(element);
  }

  private isTextareaOrInput(element: HTMLElement): element is HTMLTextAreaElement | HTMLInputElement {
    const tagName = element.tagName.toLowerCase();
    return tagName === 'textarea' || tagName === 'input';
  }

  async proofreadActiveElement(): Promise<void> {
    if (!this.activeElement) return;

    await this.proofreadElement(this.activeElement);
    this.sidebar?.show();
  }

  private updateSidebar(element: HTMLElement, corrections: ProofreadCorrection[]): void {
    if (!this.sidebar) return;

    const issues: IssueItem[] = corrections.map((correction, index) => ({
      element,
      correction,
      index,
    }));

    this.sidebar.setIssues(issues);
  }

  private handleCorrectionFromPopover(element: HTMLElement, correction: ProofreadCorrection): void {
    this.applyCorrectionToElement(element, correction);
  }

  private applyCorrection(issue: IssueItem): void {
    const { element, correction } = issue;
    this.applyCorrectionToElement(element, correction);
  }

  private isEditableElement(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'proofly-issues-sidebar') return false;

    if (tagName === 'textarea') {
      return true;
    }

    if (tagName === 'input') {
      const inputType = (element as HTMLInputElement).type;
      return !inputType || ['text', 'email', 'search', 'url'].includes(inputType);
    }

    return element.isContentEditable || element.hasAttribute('contenteditable');
  }

  private getElementText(element: HTMLElement): string {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'textarea' || tagName === 'input') {
      return (element as HTMLInputElement | HTMLTextAreaElement).value;
    }

    return element.textContent || '';
  }

  private setElementText(element: HTMLElement, text: string): void {
    this.isApplyingCorrection = true;

    try {
      const tagName = element.tagName.toLowerCase();

      if (tagName === 'textarea' || tagName === 'input') {
        (element as HTMLInputElement | HTMLTextAreaElement).value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        element.textContent = text;
      }
    } finally {
      this.isApplyingCorrection = false;
    }
  }

  private applyCorrectionWithUndo(element: HTMLTextAreaElement | HTMLInputElement, correction: ProofreadCorrection): void {
    this.isApplyingCorrection = true;

    try {
      const originalStart = element.selectionStart;
      const originalEnd = element.selectionEnd;

      element.focus();
      element.setSelectionRange(correction.startIndex, correction.endIndex);

      const isSupported = document.execCommand('insertText', false, correction.correction);

      if (!isSupported) {
        const text = element.value;
        const before = text.substring(0, correction.startIndex);
        const after = text.substring(correction.endIndex);
        element.value = before + correction.correction + after;

        const newPosition = correction.startIndex + correction.correction.length;
        element.setSelectionRange(newPosition, newPosition);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (originalStart !== null && originalEnd !== null) {
        const lengthDiff = correction.correction.length - (correction.endIndex - correction.startIndex);
        let newStart = originalStart;
        let newEnd = originalEnd;

        if (originalStart > correction.endIndex) {
          newStart = originalStart + lengthDiff;
        } else if (originalStart > correction.startIndex) {
          newStart = correction.startIndex + correction.correction.length;
        }

        if (originalEnd > correction.endIndex) {
          newEnd = originalEnd + lengthDiff;
        } else if (originalEnd > correction.startIndex) {
          newEnd = correction.startIndex + correction.correction.length;
        }

        element.setSelectionRange(newStart, newEnd);
      }
    } finally {
      this.isApplyingCorrection = false;
    }
  }

  destroy(): void {
    this.highlighter.destroy();
    this.sidebar?.remove();
    this.popover?.remove();
    this.observer?.disconnect();

    this.elementCanvasHighlighters.forEach(highlighter => highlighter.destroy());
    this.elementCanvasHighlighters.clear();

    this.elementPreviousText.clear();
    this.proofreadQueue.clear();

    this.cleanupHandler(this.popoverHideCleanup);
    this.popoverHideCleanup = null;

    this.cleanupHandler(this.correctionTypeCleanup);
    this.correctionTypeCleanup = null;

    this.cleanupHandler(this.correctionColorsCleanup);
    this.correctionColorsCleanup = null;
  }
}
