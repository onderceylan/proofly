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

  async initialize(): Promise<void> {
    // Initialize proofreader service
    try {
      console.log('Proofly: Starting proofreader initialization');
      const proofreader = await createProofreader();
      console.log('Proofly: Proofreader created');
      const adapter = createProofreaderAdapter(proofreader);
      this.proofreaderService = createProofreadingService(adapter);
      console.log('Proofly: Proofreader service initialized successfully');
    } catch (error) {
      console.error('Proofly: Failed to initialize proofreader:', error);
      return;
    }

    console.log('Proofly: Setting up event listeners');
    this.createSidebar();
    this.createPopover();
    this.setupContextMenuHandler();
    this.observeEditableElements();
    console.log('Proofly: Event listeners set up - ready for input!');
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
      return;
    }

    this.popover = document.createElement('proofly-correction-popover') as CorrectionPopover;
    document.body.appendChild(this.popover);
  }

  private setupContextMenuHandler(): void {
    document.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      if (this.isEditableElement(target)) {
        this.activeElement = target;
      }
    });
  }

  private observeEditableElements(): void {
    const debouncedProofread = debounce((element: HTMLElement) => {
      void this.proofreadElement(element);
    }, 1500);

    const handleInput = (e: Event) => {
      const target = e.target as HTMLElement;
      if (this.isEditableElement(target)) {
        debouncedProofread(target);
      }
    };

    document.addEventListener('input', handleInput, true);

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as HTMLElement;
              if (this.isEditableElement(element)) {
                const text = this.getElementText(element);
                if (text && text.length > 10) {
                  debouncedProofread(element);
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

    try {
      const result = await this.proofreaderService.proofread(text);

      if (result.corrections && result.corrections.length > 0) {
        this.elementCorrections.set(element, result.corrections);

        // For textarea/input, use canvas overlay
        if (this.isTextareaOrInput(element)) {
          this.highlightWithCanvas(element as HTMLTextAreaElement | HTMLInputElement, result.corrections);
        } else {
          // For contenteditable, use direct highlighting
          this.highlighter.highlight(element, result.corrections);
        }

        this.updateSidebar(element, result.corrections);

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

        console.log(`Proofly: Found ${result.corrections.length} corrections`);
      } else {
        this.clearElementHighlights(element);
      }
    } catch (error) {
      console.error('Proofly: Proofreading failed:', error);
    }
  }

  private highlightWithCanvas(element: HTMLTextAreaElement | HTMLInputElement, corrections: ProofreadCorrection[]): void {
    // Create or reuse canvas highlighter for this element
    let canvasHighlighter = this.elementCanvasHighlighters.get(element);

    if (!canvasHighlighter) {
      canvasHighlighter = new TextareaCanvasHighlighter(element);
      this.elementCanvasHighlighters.set(element, canvasHighlighter);

      // Setup click handler for popover
      canvasHighlighter.setOnCorrectionClick((correction, x, y) => {
        this.showPopoverForCorrection(element, correction, x, y);
      });
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
    // clickedElement might be a mirror, so we need to find the actual textarea
    let actualElement = originalElement;

    if (this.isTextareaOrInput(originalElement)) {
      // originalElement is the textarea - use it directly
      actualElement = originalElement;
    } else if (clickedElement.hasAttribute('data-proofly-mirror')) {
      // clickedElement is a mirror, find the actual textarea
      for (const [textarea, mirror] of this.elementMirrors.entries()) {
        if (mirror.getElement() === clickedElement) {
          actualElement = textarea;
          break;
        }
      }
    }

    // Apply the correction
    const text = this.getElementText(actualElement);
    if (!text) return;

    const newText =
      text.substring(0, correction.startIndex) +
      correction.correction +
      text.substring(correction.endIndex);

    this.setElementText(actualElement, newText);

    // Update corrections and re-highlight
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
  }

  private applyCorrection(issue: IssueItem): void {
    const { element, correction } = issue;

    // BUG FIX: If element is a mirror, get the actual textarea
    let actualElement = element;
    if (element.hasAttribute('data-proofly-mirror')) {
      // Find the textarea that this mirror belongs to
      for (const [textarea, mirror] of this.elementMirrors.entries()) {
        if (mirror.getElement() === element) {
          actualElement = textarea;
          break;
        }
      }
    }

    const text = this.getElementText(actualElement);

    if (!text) return;

    const newText =
      text.substring(0, correction.startIndex) +
      correction.correction +
      text.substring(correction.endIndex);

    this.setElementText(actualElement, newText);

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
        // For textarea/input, need to re-highlight on canvas
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
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'textarea' || tagName === 'input') {
      (element as HTMLInputElement | HTMLTextAreaElement).value = text;
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      element.textContent = text;
    }
  }

  destroy(): void {
    this.highlighter.destroy();
    this.sidebar?.remove();
    this.popover?.remove();
    this.observer?.disconnect();

    // Clean up all mirrors (legacy)
    this.elementMirrors.forEach(mirror => mirror.destroy());
    this.elementMirrors.clear();

    // Clean up all canvas highlighters
    this.elementCanvasHighlighters.forEach(highlighter => highlighter.destroy());
    this.elementCanvasHighlighters.clear();
  }
}
