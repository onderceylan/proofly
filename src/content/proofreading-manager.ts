import { debounce } from '../shared/utils/debounce.ts';
import { ContentHighlighter } from './components/content-highlighter.ts';
import { TextareaMirror } from './components/textarea-mirror.ts';
import { TextareaCanvasHighlighter } from './components/textarea-canvas-highlighter.ts';
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

export class ProofreadingManager {
  private highlighter = new ContentHighlighter();
  private sidebar: IssuesSidebar | null = null;
  private popover: CorrectionPopover | null = null;
  private activeElement: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private elementCorrections = new Map<HTMLElement, ProofreadCorrection[]>();
  private elementMirrors = new Map<HTMLElement, TextareaMirror>();
  private elementCanvasHighlighters = new Map<HTMLElement, TextareaCanvasHighlighter>();
  private proofreaderService: ReturnType<typeof createProofreadingService> | null = null;
  private elementPreviousText = new Map<HTMLElement, string>();
  private isApplyingCorrection = false;
  private debouncedProofread: ((element: HTMLElement) => void) | null = null;
  private activeCanvasHighlighter: TextareaCanvasHighlighter | null = null;
  private popoverHideCleanup: (() => void) | null = null;

  async initialize(): Promise<void> {
    // Initialize proofreader service
    try {
      logger.info('Proofly: Starting proofreader initialization');
      const proofreader = await createProofreader();
      logger.info('Proofly: Proofreader created');
      const adapter = createProofreaderAdapter(proofreader);
      this.proofreaderService = createProofreadingService(adapter);
      logger.info('Proofly: Proofreader service initialized successfully');
    } catch (error) {
      logger.error({error}, 'Proofly: Failed to initialize proofreader');
      return;
    }

    logger.info('Proofly: Setting up event listeners');
    this.createSidebar();
    this.createPopover();
    this.setupContextMenuHandler();
    this.observeEditableElements();
    logger.info('Proofly: Event listeners set up - ready for input!');
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

    if (this.popoverHideCleanup) {
      this.popoverHideCleanup();
      this.popoverHideCleanup = null;
    }

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

      if (this.isTextareaOrInput(element)) {
        this.highlightWithCanvas(element as HTMLTextAreaElement | HTMLInputElement, validCorrections);
      } else {
        this.highlighter.highlight(element, validCorrections);
      }

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

          // Trigger proofreading if element has text but hasn't been proofread yet
          if (!hasCorrections && !hasPreviousText) {
            this.debouncedProofread?.(target);
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
                  this.debouncedProofread?.(element);
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

    try {
      const result = await this.proofreaderService.proofread(text);

      const currentText = this.getElementText(element);
      if (currentText !== text) {
        logger.info('Proofly: Text changed during proofreading, discarding stale results');
        return;
      }

      if (result.corrections && result.corrections.length > 0) {
        const trimmedLength = text.trimEnd().length;
        const filteredCorrections = result.corrections.filter(correction =>
          correction.startIndex < trimmedLength
        );

        if (filteredCorrections.length === 0) {
          this.clearElementHighlights(element);
          return;
        }

        this.elementCorrections.set(element, filteredCorrections);

        // For textarea/input, use canvas overlay
        if (this.isTextareaOrInput(element)) {
          this.highlightWithCanvas(element as HTMLTextAreaElement | HTMLInputElement, filteredCorrections);
        } else {
          // For contenteditable, use direct highlighting
          this.highlighter.highlight(element, filteredCorrections);
        }

        this.updateSidebar(element, filteredCorrections);

        // Setup callback for when corrections are applied via clicking highlights
        const targetElement = this.getHighlightTarget(element);
        this.highlighter.setOnCorrectionApplied(targetElement, (updatedCorrections) => {
          this.elementCorrections.set(element, updatedCorrections);
          this.updateSidebar(element, updatedCorrections);
        });

        // Setup callback to actually apply the correction text
        this.highlighter.setApplyCorrectionCallback(targetElement, (clickedElement, correction) => {
          this.handleCorrectionFromPopover(element, clickedElement, correction);
        });

        logger.info(`Proofly: Found ${filteredCorrections.length} corrections`);
      } else {
        this.clearElementHighlights(element);
      }
    } catch (error) {
      logger.error({ error }, 'Proofly: Proofreading failed');
    }
  }

  private highlightWithCanvas(element: HTMLTextAreaElement | HTMLInputElement, corrections: ProofreadCorrection[]): void {
    // Create or reuse canvas highlighter for this element
    let canvasHighlighter = this.elementCanvasHighlighters.get(element);

    if (!canvasHighlighter) {
      canvasHighlighter = new TextareaCanvasHighlighter(element);
      this.elementCanvasHighlighters.set(element, canvasHighlighter);

      const highlighterInstance = canvasHighlighter;
      // Setup click handler for popover
      canvasHighlighter.setOnCorrectionClick((correction, x, y) => {
        this.activeCanvasHighlighter = highlighterInstance;
        this.showPopoverForCorrection(element, correction, x, y);
      });
    }

    if (!canvasHighlighter) {
      return;
    }

    // Draw highlights on canvas
    canvasHighlighter.drawHighlights(corrections);
  }

  private showPopoverForCorrection(element: HTMLElement, correction: ProofreadCorrection, x: number, y: number): void {
    if (!this.popover) return;

    this.popover.setCorrection(correction, (appliedCorrection) => {
      this.handleCorrectionFromPopover(element, element, appliedCorrection);
    });

    this.popover.show(x, y + 20); // Show below the click point
  }

  private getHighlightTarget(element: HTMLElement): HTMLElement {
    // For textarea/input, return the mirror element
    if (this.isTextareaOrInput(element)) {
      const mirror = this.elementMirrors.get(element);
      return mirror ? mirror.getElement() : element;
    }
    return element;
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

  private handleCorrectionFromPopover(originalElement: HTMLElement, clickedElement: HTMLElement, correction: ProofreadCorrection): void {
    let actualElement = originalElement;

    if (this.isTextareaOrInput(originalElement)) {
      actualElement = originalElement;
    } else if (clickedElement.hasAttribute('data-proofly-mirror')) {
      for (const [textarea, mirror] of this.elementMirrors.entries()) {
        if (mirror.getElement() === clickedElement) {
          actualElement = textarea;
          break;
        }
      }
    }

    const text = this.getElementText(actualElement);
    if (!text) return;

    if (this.isTextareaOrInput(actualElement)) {
      this.applyCorrectionWithUndo(actualElement as HTMLTextAreaElement | HTMLInputElement, correction);
    } else {
      const newText =
        text.substring(0, correction.startIndex) +
        correction.correction +
        text.substring(correction.endIndex);
      this.setElementText(actualElement, newText);
    }

    const newText = this.getElementText(actualElement);
    this.elementPreviousText.set(actualElement, newText);

    const lengthDiff = correction.correction.length - (correction.endIndex - correction.startIndex);
    const corrections = this.elementCorrections.get(actualElement);
    if (corrections) {
      const updatedCorrections = corrections
        .filter(c => c !== correction)
        .map(c => {
          if (c.startIndex > correction.startIndex) {
            return {
              ...c,
              startIndex: c.startIndex + lengthDiff,
              endIndex: c.endIndex + lengthDiff
            };
          }
          return c;
        });

      this.elementCorrections.set(actualElement, updatedCorrections);

      if (updatedCorrections.length > 0) {
        if (this.isTextareaOrInput(actualElement)) {
          this.highlightWithCanvas(actualElement as HTMLTextAreaElement | HTMLInputElement, updatedCorrections);
        } else {
          this.highlighter.highlight(actualElement, updatedCorrections);
        }
        this.updateSidebar(actualElement, updatedCorrections);
      } else {
        this.clearElementHighlights(actualElement);
        this.sidebar?.setIssues([]);
      }
    }

    this.debouncedProofread?.(actualElement);
  }

  private applyCorrection(issue: IssueItem): void {
    const { element, correction } = issue;

    let actualElement = element;
    if (element.hasAttribute('data-proofly-mirror')) {
      for (const [textarea, mirror] of this.elementMirrors.entries()) {
        if (mirror.getElement() === element) {
          actualElement = textarea;
          break;
        }
      }
    }

    const text = this.getElementText(actualElement);
    if (!text) return;

    if (this.isTextareaOrInput(actualElement)) {
      this.applyCorrectionWithUndo(actualElement as HTMLTextAreaElement | HTMLInputElement, correction);
    } else {
      const newText =
        text.substring(0, correction.startIndex) +
        correction.correction +
        text.substring(correction.endIndex);
      this.setElementText(actualElement, newText);
    }

    const newText = this.getElementText(actualElement);
    this.elementPreviousText.set(actualElement, newText);

    const lengthDiff = correction.correction.length - (correction.endIndex - correction.startIndex);

    const corrections = this.elementCorrections.get(actualElement);
    if (corrections) {
      const updatedCorrections = corrections
        .filter(c => c !== correction)
        .map(c => {
          if (c.startIndex > correction.startIndex) {
            return {
              ...c,
              startIndex: c.startIndex + lengthDiff,
              endIndex: c.endIndex + lengthDiff
            };
          }
          return c;
        });

      this.elementCorrections.set(actualElement, updatedCorrections);

      if (updatedCorrections.length > 0) {
        if (this.isTextareaOrInput(actualElement)) {
          this.highlightWithCanvas(actualElement as HTMLTextAreaElement | HTMLInputElement, updatedCorrections);
        } else {
          this.highlighter.highlight(actualElement, updatedCorrections);
        }
        this.updateSidebar(actualElement, updatedCorrections);
      } else {
        this.clearElementHighlights(actualElement);
        this.sidebar?.setIssues([]);
      }
    }

    this.debouncedProofread?.(actualElement);
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

    this.elementMirrors.forEach(mirror => mirror.destroy());
    this.elementMirrors.clear();

    this.elementCanvasHighlighters.forEach(highlighter => highlighter.destroy());
    this.elementCanvasHighlighters.clear();

    this.elementPreviousText.clear();
  }
}
