import { CORRECTION_TYPE_COLORS } from '../../shared/utils/correction-colors.ts';
import './correction-popover.ts';
import type { CorrectionPopover } from './correction-popover.ts';

export interface HighlightableElement {
  element: HTMLElement;
  originalText: string;
}

const ERROR_TYPES = [
  'spelling',
  'grammar',
  'punctuation',
  'capitalization',
  'preposition',
  'missing-words',
] as const;

export class ContentHighlighter {
  private highlightedElements = new Map<HTMLElement, ProofreadCorrection[]>();
  private observers = new Map<HTMLElement, MutationObserver>();
  private highlights = new Map<string, Highlight>();
  private popover: CorrectionPopover | null = null;
  private clickHandlers = new Map<HTMLElement, (e: MouseEvent) => void>();
  private onCorrectionAppliedCallbacks = new Map<HTMLElement, (updatedCorrections: ProofreadCorrection[]) => void>();
  private applyCorrectionCallbacks = new Map<HTMLElement, (element: HTMLElement, correction: ProofreadCorrection) => void>();

  constructor() {
    this.initializeHighlights();
    this.initializePopover();
  }

  setOnCorrectionApplied(element: HTMLElement, callback: (updatedCorrections: ProofreadCorrection[]) => void): void {
    this.onCorrectionAppliedCallbacks.set(element, callback);
  }

  setApplyCorrectionCallback(element: HTMLElement, callback: (element: HTMLElement, correction: ProofreadCorrection) => void): void {
    this.applyCorrectionCallbacks.set(element, callback);
  }

  private initializeHighlights(): void {
    if (!('highlights' in CSS)) {
      console.warn('CSS Custom Highlights API not supported');
      return;
    }

    for (const errorType of ERROR_TYPES) {
      const highlight = new Highlight();
      this.highlights.set(errorType, highlight);
      CSS.highlights.set(errorType, highlight);
    }
  }

  private initializePopover(): void {
    // Create popover in document body, not shadow DOM
    if (!document.querySelector('proofly-correction-popover')) {
      this.popover = document.createElement('proofly-correction-popover') as unknown as CorrectionPopover;
      document.body.appendChild(this.popover);
    } else {
      this.popover = document.querySelector('proofly-correction-popover') as unknown as CorrectionPopover;
    }
  }

  highlight(element: HTMLElement, corrections: ProofreadCorrection[]): void {
    if (!this.isEditableElement(element)) return;

    const text = this.getElementText(element);
    if (!text) return;

    this.highlightedElements.set(element, corrections);
    this.applyHighlights(element, corrections);
    this.attachClickHandler(element);
  }

  private attachClickHandler(element: HTMLElement): void {
    if (this.clickHandlers.has(element)) return;

    const handler = (e: MouseEvent) => {
      this.handleElementClick(element, e);
    };

    element.addEventListener('click', handler);
    this.clickHandlers.set(element, handler);
  }

  private handleElementClick(element: HTMLElement, event: MouseEvent): void {
    if (!this.popover) {
      console.warn('Popover not initialized');
      return;
    }

    const corrections = this.highlightedElements.get(element);
    if (!corrections || corrections.length === 0) {
      console.log('No corrections found for element');
      return;
    }

    // Find which correction was clicked using CSS.highlights API
    const clickedCorrection = this.findCorrectionAtPoint(element, event.clientX, event.clientY, corrections);

    console.log('Click detected at coordinates:', event.clientX, event.clientY);
    console.log('Available corrections:', corrections);
    console.log('Found correction:', clickedCorrection);

    if (!clickedCorrection) {
      try {
        this.popover.hidePopover();
      } catch (e) {
        console.warn('Failed to hide popover:', e);
      }
      return;
    }

    this.popover.setCorrection(clickedCorrection, (appliedCorrection) => {
      this.applyCorrection(element, appliedCorrection);
    });

    const x = event.clientX;
    const y = event.clientY + 20;

    console.log('Showing popover at:', x, y);
    this.popover.show(x, y);
  }

  private findCorrectionAtPoint(element: HTMLElement, x: number, y: number, corrections: ProofreadCorrection[]): ProofreadCorrection | null {
    // First try: use caretRangeFromPoint/caretPositionFromPoint with the element context
    const caretBasedCorrection = this.findCorrectionUsingCaret(element, x, y, corrections);
    if (caretBasedCorrection) {
      return caretBasedCorrection;
    }

    // Fallback: Check if CSS.highlights.highlightsFromPoint is available
    if ('highlights' in CSS && 'highlightsFromPoint' in CSS.highlights) {
      const highlightsAtPoint = (CSS.highlights as any).highlightsFromPoint(x, y);

      // Find which error type was clicked
      for (const highlight of highlightsAtPoint) {
        const errorType = ERROR_TYPES.find(type => this.highlights.get(type) === highlight);
        if (errorType) {
          // Return the first correction of this type near the click point
          // Since we can't get the exact range from highlightsFromPoint,
          // we'll need to check all corrections of this type
          return corrections.find(c => c.type === errorType) || null;
        }
      }
    }

    return null;
  }

  private findCorrectionUsingCaret(element: HTMLElement, x: number, y: number, corrections: ProofreadCorrection[]): ProofreadCorrection | null {
    // Get the text node within the element
    const textNode = this.getFirstTextNode(element);
    if (!textNode || !textNode.textContent) {
      console.log('No text node found in element');
      return null;
    }

    const text = textNode.textContent;
    const textLength = text.length;

    // Find which character position is closest to the click coordinates
    let closestOffset = 0;
    let minDistance = Infinity;

    for (let i = 0; i < textLength; i++) {
      const range = document.createRange();
      try {
        range.setStart(textNode, i);
        range.setEnd(textNode, Math.min(i + 1, textLength));
        const rect = range.getBoundingClientRect();

        // Calculate distance from click point to character center
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));

        if (distance < minDistance) {
          minDistance = distance;
          closestOffset = i;
        }
      } catch (e) {
        // Skip if range creation fails
        continue;
      }
    }

    console.log('Closest character offset:', closestOffset, 'at distance:', minDistance);
    console.log('Looking for correction at offset', closestOffset, 'in', corrections.length, 'corrections');

    // Find correction that contains this offset
    const found = corrections.find(
      (c) => c.startIndex <= closestOffset && closestOffset < c.endIndex
    );

    if (found) {
      console.log('Found correction:', found);
    } else {
      console.log('No correction found at offset', closestOffset);
      console.log('Available correction ranges:', corrections.map(c => `[${c.startIndex}-${c.endIndex}]`).join(', '));
    }

    return found || null;
  }

  private applyCorrection(element: HTMLElement, correction: ProofreadCorrection): void {
    // Check if there's a callback to handle the correction application
    const applyCallback = this.applyCorrectionCallbacks.get(element);
    if (applyCallback) {
      // Delegate to the callback (ProofreadingManager) which knows how to handle mirrors
      applyCallback(element, correction);
      return;
    }

    // Fallback: apply directly (for non-mirror elements)
    const text = this.getElementText(element);
    const newText =
      text.substring(0, correction.startIndex) +
      correction.correction +
      text.substring(correction.endIndex);

    if (element.tagName.toLowerCase() === 'textarea' || element.tagName.toLowerCase() === 'input') {
      (element as HTMLInputElement | HTMLTextAreaElement).value = newText;
    } else {
      element.textContent = newText;
    }

    const lengthDiff = correction.correction.length - (correction.endIndex - correction.startIndex);

    const corrections = this.highlightedElements.get(element);
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

      this.highlightedElements.set(element, updatedCorrections);

      if (updatedCorrections.length > 0) {
        this.applyHighlights(element, updatedCorrections);
      } else {
        this.clearHighlights(element);
      }

      const callback = this.onCorrectionAppliedCallbacks.get(element);
      if (callback) {
        callback(updatedCorrections);
      }
    }
  }

  clearHighlights(element: HTMLElement): void {
    this.highlightedElements.delete(element);
    this.removeHighlights(element);
  }

  clearAllHighlights(): void {
    for (const element of this.highlightedElements.keys()) {
      this.clearHighlights(element);
    }
  }

  getCorrections(element: HTMLElement): ProofreadCorrection[] {
    return this.highlightedElements.get(element) || [];
  }

  getAllHighlightedElements(): HTMLElement[] {
    return Array.from(this.highlightedElements.keys());
  }

  private isEditableElement(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'textarea' || tagName === 'input') {
      return true;
    }

    return (
      element.isContentEditable ||
      element.hasAttribute('contenteditable')
    );
  }

  private getElementText(element: HTMLElement): string {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'textarea' || tagName === 'input') {
      return (element as HTMLInputElement | HTMLTextAreaElement).value;
    }

    return element.textContent || '';
  }

  private applyHighlights(
    element: HTMLElement,
    corrections: ProofreadCorrection[]
  ): void {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'textarea' || tagName === 'input') {
      console.warn('CSS Custom Highlights API does not support input/textarea elements');
      return;
    }

    this.highlightContentEditableElement(element, corrections);
  }

  private highlightContentEditableElement(
    element: HTMLElement,
    corrections: ProofreadCorrection[]
  ): void {
    if (!('highlights' in CSS)) {
      return;
    }

    this.clearHighlightsForElement(element);

    const textNode = this.getFirstTextNode(element);
    if (!textNode) {
      return;
    }

    for (const correction of corrections) {
      const range = new Range();
      try {
        range.setStart(textNode, correction.startIndex);
        range.setEnd(textNode, correction.endIndex);

        const errorType = correction.type || 'spelling';
        const highlight = this.highlights.get(errorType);
        if (highlight) {
          highlight.add(range);
        }
      } catch (error) {
        console.warn('Failed to create highlight range:', error);
      }
    }
  }

  private getFirstTextNode(element: HTMLElement): Text | null {
    if (element.firstChild && element.firstChild.nodeType === Node.TEXT_NODE) {
      return element.firstChild as Text;
    }

    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null
    );
    return walker.nextNode() as Text | null;
  }

  private clearHighlightsForElement(_element: HTMLElement): void {
    for (const highlight of this.highlights.values()) {
      highlight.clear();
    }
  }


  private removeHighlights(element: HTMLElement): void {
    this.clearHighlightsForElement(element);
    this.observers.get(element)?.disconnect();
    this.observers.delete(element);

    const handler = this.clickHandlers.get(element);
    if (handler) {
      element.removeEventListener('click', handler);
      this.clickHandlers.delete(element);
    }
  }

  destroy(): void {
    this.clearAllHighlights();
    this.observers.forEach(observer => observer.disconnect());
    this.observers.clear();

    this.clickHandlers.forEach((handler, element) => {
      element.removeEventListener('click', handler);
    });
    this.clickHandlers.clear();

    if (this.popover) {
      this.popover.remove();
      this.popover = null;
    }

    if ('highlights' in CSS) {
      for (const errorType of ERROR_TYPES) {
        CSS.highlights.delete(errorType);
      }
    }
    this.highlights.clear();
  }
}

if ('highlights' in CSS) {
  const style = document.createElement('style');
  style.textContent = ERROR_TYPES.map((errorType) => {
    const colors = CORRECTION_TYPE_COLORS[errorType];
    return `
    ::highlight(${errorType}) {
      background-color: transparent;
      text-decoration: underline;
      text-decoration-color: ${colors.color};
      text-decoration-thickness: 2px;
      text-decoration-style: wavy;
    }`;
  }).join('\n');

  document.head.appendChild(style);
}

