import {
  getActiveCorrectionColors,
  type CorrectionColorThemeMap,
} from '../../shared/utils/correction-types.ts';
import { STORAGE_KEYS } from '../../shared/constants.ts';
import { getStorageValue, onStorageChange } from '../../shared/utils/storage.ts';
import type { UnderlineStyle } from '../../shared/types.ts';
import './correction-popover.ts';
import type { CorrectionPopover } from './correction-popover.ts';
import { logger } from '../../services/logger.ts';
import { replaceTextWithUndo } from '../../shared/utils/clipboard.ts';

const ERROR_TYPES = [
  'spelling',
  'grammar',
  'punctuation',
  'capitalization',
  'preposition',
  'missing-words',
] as const;

const SELECTED_HIGHLIGHT = 'prfly-selected';

export class ContentHighlighter {
  private highlightedElements = new Map<HTMLElement, ProofreadCorrection[]>();
  private observers = new Map<HTMLElement, MutationObserver>();
  private highlights = new Map<string, Highlight>();
  private elementRanges = new Map<HTMLElement, Range[]>();
  private popover: CorrectionPopover | null = null;
  private clickHandlers = new Map<HTMLElement, (e: MouseEvent) => void>();
  private dblClickHandlers = new Map<HTMLElement, (e: MouseEvent) => void>();
  private onCorrectionAppliedCallbacks = new Map<HTMLElement, (updatedCorrections: ProofreadCorrection[]) => void>();
  private applyCorrectionCallbacks = new Map<HTMLElement, (element: HTMLElement, correction: ProofreadCorrection) => void>();
  private underlineStyleCleanup: (() => void) | null = null;
  private autofixCleanup: (() => void) | null = null;
  private selectedHighlight: Highlight | null = null;
  private selectedElement: HTMLElement | null = null;
  private selectedCorrectionRange: { start: number; end: number; type?: string } | null = null;
  private popoverHideCleanup: (() => void) | null = null;
  private correctionColors: CorrectionColorThemeMap = getActiveCorrectionColors();
  private currentUnderlineStyle: UnderlineStyle = 'solid';
  private autofixOnDoubleClick: boolean = false;

  constructor() {
    this.initializeHighlights();
    this.initializePopover();
    void this.initializeUnderlineStyle();
    void this.initializeAutofixSetting();
  }

  setOnCorrectionApplied(element: HTMLElement, callback: (updatedCorrections: ProofreadCorrection[]) => void): void {
    this.onCorrectionAppliedCallbacks.set(element, callback);
  }

  setApplyCorrectionCallback(element: HTMLElement, callback: (element: HTMLElement, correction: ProofreadCorrection) => void): void {
    this.applyCorrectionCallbacks.set(element, callback);
  }

  setCorrectionColors(colors: CorrectionColorThemeMap): void {
    this.correctionColors = structuredClone(colors);
    this.applyHighlightStyles();
    if (this.selectedCorrectionRange) {
      setSelectedHighlightColors(this.selectedCorrectionRange.type, this.correctionColors);
    }
  }

  private initializeHighlights(): void {
    if (!('highlights' in CSS)) {
      logger.warn('CSS Custom Highlights API not supported');
      return;
    }

    for (const errorType of ERROR_TYPES) {
      const highlight = new Highlight();
      this.highlights.set(errorType, highlight);
      CSS.highlights.set(errorType, highlight);
    }

    this.selectedHighlight = new Highlight();
    CSS.highlights.set(SELECTED_HIGHLIGHT, this.selectedHighlight);
  }

  private async initializeUnderlineStyle(): Promise<void> {
    if (!('highlights' in CSS)) {
      return;
    }

    this.currentUnderlineStyle = await loadUnderlineStyle();
    this.applyHighlightStyles();

    this.underlineStyleCleanup = onStorageChange(
      STORAGE_KEYS.UNDERLINE_STYLE,
      (newValue) => {
        this.currentUnderlineStyle = newValue;
        this.applyHighlightStyles();
      }
    );
  }

  private async initializeAutofixSetting(): Promise<void> {
    try {
      this.autofixOnDoubleClick = await getStorageValue(STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK);
    } catch (error) {
      logger.error(error, 'Failed to load autofix setting');
      this.autofixOnDoubleClick = false;
    }

    this.autofixCleanup = onStorageChange(
      STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK,
      (newValue) => {
        this.autofixOnDoubleClick = newValue;
      }
    );
  }

  private applyHighlightStyles(): void {
    if (!('highlights' in CSS)) {
      return;
    }

    updateHighlightStyle(this.currentUnderlineStyle, this.correctionColors);
  }

  private initializePopover(): void {
    // Create popover in document body, not shadow DOM
    if (!document.querySelector('proofly-correction-popover')) {
      this.popover = document.createElement('proofly-correction-popover') as unknown as CorrectionPopover;
      document.body.appendChild(this.popover);
    } else {
      this.popover = document.querySelector('proofly-correction-popover') as unknown as CorrectionPopover;
    }

    if (this.popoverHideCleanup) {
      this.popoverHideCleanup();
      this.popoverHideCleanup = null;
    }

    if (this.popover) {
      const handlePopoverHide = () => {
        this.clearSelectedCorrection();
      };
      this.popover.addEventListener('proofly:popover-hide', handlePopoverHide);
      this.popoverHideCleanup = () => {
        this.popover?.removeEventListener('proofly:popover-hide', handlePopoverHide);
      };
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

    const clickHandler = (e: MouseEvent) => {
      this.handleElementClick(element, e);
    };

    const dblClickHandler = (e: MouseEvent) => {
      this.handleElementDoubleClick(element, e);
    };

    element.addEventListener('click', clickHandler);
    element.addEventListener('dblclick', dblClickHandler);
    this.clickHandlers.set(element, clickHandler);
    this.dblClickHandlers.set(element, dblClickHandler);
  }

  private handleElementClick(element: HTMLElement, event: MouseEvent): void {
    // If autofix is enabled, prevent popover on single click
    if (this.autofixOnDoubleClick) {
      return;
    }

    if (!this.popover) {
      logger.warn('Popover not initialized');
      return;
    }

    const corrections = this.highlightedElements.get(element);
    if (!corrections || corrections.length === 0) {
      logger.info('No corrections found for element');
      return;
    }

    // Find which correction was clicked using CSS.highlights API
    const clickedCorrection = this.findCorrectionAtPoint(element, event.clientX, event.clientY, corrections);

    logger.info({
      clientX: event.clientX,
      clientY: event.clientY
    },'Click detected at coordinates:');

    logger.info(corrections, 'Available corrections');
    logger.info(clickedCorrection, 'Found correction');

    if (!clickedCorrection) {
      try {
        this.popover.hidePopover();
      } catch (e) {
        logger.warn({ error:  e },'Failed to hide popover');
      }
      this.clearSelectedCorrection();
      return;
    }

    this.highlightSelectedCorrection(element, clickedCorrection);

    const elementText = this.getElementText(element);
    const issueText = elementText.substring(
      clickedCorrection.startIndex,
      clickedCorrection.endIndex
    );

    this.popover.setCorrection(clickedCorrection, issueText, (appliedCorrection) => {
      this.applyCorrection(element, appliedCorrection);
    });

    const correctionRect = this.getCorrectionBoundingRect(element, clickedCorrection);
    const x = correctionRect ? correctionRect.left + correctionRect.width / 2 : event.clientX;
    const y = correctionRect ? correctionRect.bottom + 8 : event.clientY + 20;

    logger.info({ x, y }, 'Showing popover at');
    this.popover.show(x, y);
  }

  private handleElementDoubleClick(element: HTMLElement, event: MouseEvent): void {
    // Only process double-click if autofix is enabled
    if (!this.autofixOnDoubleClick) {
      return;
    }

    const corrections = this.highlightedElements.get(element);
    if (!corrections || corrections.length === 0) {
      logger.info('No corrections found for element');
      return;
    }

    // Find which correction was double-clicked using CSS.highlights API
    const clickedCorrection = this.findCorrectionAtPoint(element, event.clientX, event.clientY, corrections);

    logger.info({
      clientX: event.clientX,
      clientY: event.clientY
    },'Double-click detected at coordinates:');

    logger.info(clickedCorrection, 'Found correction for autofix');

    if (!clickedCorrection) {
      return;
    }

    // Apply correction immediately without showing popover
    this.applyCorrection(element, clickedCorrection);
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
      logger.info('No text node found in element');
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

    logger.info(`Closest character offset ${closestOffset} at distance ${minDistance}`);
    logger.info(`Looking for correction at offset ${closestOffset} in ${corrections.length} corrections`);

    // Find correction that contains this offset
    const found = corrections.find(
      (c) => c.startIndex <= closestOffset && closestOffset < c.endIndex
    );

    if (found) {
      logger.info({found}, 'Found correction');
    } else {
      logger.info({closestOffset},'No correction found at offset');
      logger.info({ correctionRanges: corrections.map(c => `[${c.startIndex}-${c.endIndex}]`).join(', ')},'Available correction ranges');
    }

    return found || null;
  }

  private highlightSelectedCorrection(element: HTMLElement, correction: ProofreadCorrection): void {
    if (!('highlights' in CSS) || !this.selectedHighlight) {
      return;
    }

    const textNode = this.getFirstTextNode(element);
    if (!textNode) {
      return;
    }

    const range = createCorrectionRange(textNode, correction.startIndex, correction.endIndex);
    if (!range) {
      return;
    }

    this.selectedHighlight.clear();
    this.selectedHighlight.add(range);
    this.selectedElement = element;
    this.selectedCorrectionRange = {
      start: correction.startIndex,
      end: correction.endIndex,
      type: correction.type,
    };
    setSelectedHighlightColors(correction.type, this.correctionColors);
  }

  private clearSelectedCorrection(): void {
    if (this.selectedHighlight) {
      this.selectedHighlight.clear();
    }

    this.selectedElement = null;
    this.selectedCorrectionRange = null;
    clearSelectedHighlightColors();
  }

  private reapplySelectedHighlight(element: HTMLElement, textNode: Text): void {
    if (
      !('highlights' in CSS) ||
      !this.selectedHighlight ||
      this.selectedElement !== element ||
      !this.selectedCorrectionRange
    ) {
      return;
    }

    const range = createCorrectionRange(
      textNode,
      this.selectedCorrectionRange.start,
      this.selectedCorrectionRange.end
    );

    if (!range) {
      this.clearSelectedCorrection();
      return;
    }

    this.selectedHighlight.clear();
    this.selectedHighlight.add(range);
    setSelectedHighlightColors(this.selectedCorrectionRange.type, this.correctionColors);
  }

  private getCorrectionBoundingRect(element: HTMLElement, correction: ProofreadCorrection): DOMRect | null {
    const textNode = this.getFirstTextNode(element);
    if (!textNode) {
      return null;
    }

    const range = createCorrectionRange(textNode, correction.startIndex, correction.endIndex);
    if (!range) {
      return null;
    }

    const rects = range.getClientRects();
    if (rects.length > 0) {
      return rects[0];
    }

    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return null;
    }

    return rect;
  }

  private applyCorrection(element: HTMLElement, correction: ProofreadCorrection): void {
    // Check if there's a callback to handle the correction application
    const applyCallback = this.applyCorrectionCallbacks.get(element);
    if (applyCallback) {
      applyCallback(element, correction);
      return;
    }

    // Fallback: apply directly with undo support (for non-mirror elements like live test editor)
    replaceTextWithUndo(element, correction.startIndex, correction.endIndex, correction.correction);

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

    this.clearSelectedCorrection();
    CSS.highlights.delete(SELECTED_HIGHLIGHT);
    this.selectedHighlight = new Highlight();
    CSS.highlights.set(SELECTED_HIGHLIGHT, this.selectedHighlight);
  }

  clearHighlights(element: HTMLElement): void {
    this.highlightedElements.delete(element);
    this.elementRanges.delete(element);
    this.removeHighlights(element);
    this.clearSelectedCorrection();
  }

  clearAllHighlights(): void {
    for (const element of this.highlightedElements.keys()) {
      this.clearHighlights(element);
    }
    this.elementRanges.clear();
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
      logger.warn('CSS Custom Highlights API does not support input/textarea elements');
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

    element.setAttribute('data-proofly-contenteditable', 'true');

    this.clearHighlightsForElement(element);

    const textNode = this.getFirstTextNode(element);
    if (!textNode) {
      return;
    }

    const ranges: Range[] = [];

    for (const correction of corrections) {
      const range = new Range();
      try {
        range.setStart(textNode, correction.startIndex);
        range.setEnd(textNode, correction.endIndex);

        const errorType = correction.type || 'spelling';
        const highlight = this.highlights.get(errorType);
        if (highlight) {
          highlight.add(range);
          ranges.push(range);
        }
      } catch (error) {
        logger.warn(error, 'Failed to create highlight range');
      }
    }

    // Track ranges for this element
    this.elementRanges.set(element, ranges);

    this.reapplySelectedHighlight(element, textNode);
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

  private clearHighlightsForElement(element: HTMLElement): void {
    // Remove only the ranges that belong to this element
    const ranges = this.elementRanges.get(element);
    if (ranges) {
      for (const range of ranges) {
        // Remove this range from all highlight registries
        for (const highlight of this.highlights.values()) {
          highlight.delete(range);
        }
      }
      this.elementRanges.delete(element);
    }

    if (this.selectedElement === element) {
      this.selectedHighlight?.clear();
    }
  }


  private removeHighlights(element: HTMLElement): void {
    this.clearHighlightsForElement(element);
    this.observers.get(element)?.disconnect();
    this.observers.delete(element);

    const clickHandler = this.clickHandlers.get(element);
    if (clickHandler) {
      element.removeEventListener('click', clickHandler);
      this.clickHandlers.delete(element);
    }

    const dblClickHandler = this.dblClickHandlers.get(element);
    if (dblClickHandler) {
      element.removeEventListener('dblclick', dblClickHandler);
      this.dblClickHandlers.delete(element);
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

    this.dblClickHandlers.forEach((handler, element) => {
      element.removeEventListener('dblclick', handler);
    });
    this.dblClickHandlers.clear();

    if (this.popover) {
      this.popover.remove();
      this.popover = null;
    }

    if ('highlights' in CSS) {
      for (const errorType of ERROR_TYPES) {
        CSS.highlights.delete(errorType);
      }
      CSS.highlights.delete(SELECTED_HIGHLIGHT);
    }
    this.highlights.clear();

    if (this.underlineStyleCleanup) {
      this.underlineStyleCleanup();
      this.underlineStyleCleanup = null;
    }

    if (this.autofixCleanup) {
      this.autofixCleanup();
      this.autofixCleanup = null;
    }

    this.selectedHighlight = null;
    this.selectedElement = null;
    clearSelectedHighlightColors();

    if (this.popoverHideCleanup) {
      this.popoverHideCleanup();
      this.popoverHideCleanup = null;
    }
  }

  clearSelection(): void {
    this.clearSelectedCorrection();
  }
}

const HIGHLIGHT_STYLE_ID = 'proofly-highlight-style';
let highlightStyleElement: HTMLStyleElement | null = null;

function ensureHighlightStyleElement(): HTMLStyleElement {
  if (highlightStyleElement && document.head.contains(highlightStyleElement)) {
    return highlightStyleElement;
  }

  highlightStyleElement = document.getElementById(HIGHLIGHT_STYLE_ID) as HTMLStyleElement | null;
  if (!highlightStyleElement) {
    highlightStyleElement = document.createElement('style');
    highlightStyleElement.id = HIGHLIGHT_STYLE_ID;
    document.head.appendChild(highlightStyleElement);
  }

  return highlightStyleElement;
}

function updateHighlightStyle(style: UnderlineStyle, colors: CorrectionColorThemeMap): void {
  if (!('highlights' in CSS)) {
    return;
  }

  const styleElement = ensureHighlightStyleElement();
  styleElement.textContent = ERROR_TYPES.map((errorType) => {
    const theme = colors[errorType];
    return `
    [data-proofly-contenteditable]::highlight(${errorType}) {
      background-color: transparent;
      text-decoration: underline;
      text-decoration-color: ${theme.color};
      text-decoration-thickness: 2px;
      text-decoration-skip-ink: none;
      text-decoration-style: ${style};
      text-underline-offset: 2px;
    }`;
  }).join('\n').concat(`
  [data-proofly-contenteditable]::highlight(${SELECTED_HIGHLIGHT}) {
    background-color: var(--prfly-selected-highlight-bg, transparent);
    text-decoration: underline;
    text-decoration-color: var(--prfly-selected-highlight-color, currentColor);
    text-decoration-thickness: 2px
    text-decoration-skip-ink: none;
    text-decoration-style: ${style};
    text-underline-offset: 2px;
  }
`);
}

async function loadUnderlineStyle(): Promise<UnderlineStyle> {
  try {
    return await getStorageValue(STORAGE_KEYS.UNDERLINE_STYLE);
  } catch (error) {
    logger.error(error, 'Failed to load underline style for highlights');
    return 'solid';
  }
}

if ('highlights' in CSS) {
  updateHighlightStyle('solid', getActiveCorrectionColors());
}

function setSelectedHighlightColors(type: string | undefined, colors: CorrectionColorThemeMap): void {
  const theme = type ? colors[type as keyof CorrectionColorThemeMap] || colors.spelling : colors.spelling;
  document.documentElement.style.setProperty('--prfly-selected-highlight-bg', theme.background);
  document.documentElement.style.setProperty('--prfly-selected-highlight-color', theme.color);
}

function clearSelectedHighlightColors(): void {
  document.documentElement.style.removeProperty('--prfly-selected-highlight-bg');
  document.documentElement.style.removeProperty('--prfly-selected-highlight-color');
}

function createCorrectionRange(textNode: Text, start: number, end: number): Range | null {
  const range = new Range();
  try {
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    return range;
  } catch (error) {
    logger.warn(error,'Failed to create selected correction range:');
    return null;
  }
}
