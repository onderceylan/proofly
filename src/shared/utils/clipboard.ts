/**
 * Clipboard utility module that uses the modern Clipboard API
 * and maintains undo/redo state for text operations.
 *
 * NOTE: This module uses only modern Chrome APIs and does NOT use
 * the deprecated execCommand API.
 */

import { logger } from '../../services/logger.ts';

/**
 * Replaces a text range in an editable element, maintaining undo/redo history
 * through the UndoManager.
 *
 * Uses modern Chrome APIs:
 * - setRangeText() for textarea/input elements
 * - Selection/Range API for contenteditable elements
 *
 * @param element The target editable element
 * @param startIndex The start index of the text to replace
 * @param endIndex The end index of the text to replace
 * @param replacement The replacement text
 * @returns true if successful, false otherwise
 */
export function replaceTextWithUndo(
  element: HTMLElement,
  startIndex: number,
  endIndex: number,
  replacement: string
): boolean {
  try {
    // Note: We don't save state here because the caller is responsible for
    // saving state with appropriate metadata (e.g., correction information)

    element.focus();

    // For textarea/input elements
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      // Store original selection
      const originalStart = element.selectionStart;
      const originalEnd = element.selectionEnd;

      // Use setRangeText to replace the text (modern Chrome API)
      element.setRangeText(replacement, startIndex, endIndex, 'end');
      element.dispatchEvent(new Event('input', { bubbles: true }));

      // Restore original selection (adjusted for text length change)
      if (originalStart !== null && originalEnd !== null) {
        const lengthDiff = replacement.length - (endIndex - startIndex);
        let newStart = originalStart;
        let newEnd = originalEnd;

        if (originalStart > endIndex) {
          newStart = originalStart + lengthDiff;
        } else if (originalStart > startIndex) {
          newStart = startIndex + replacement.length;
        }

        if (originalEnd > endIndex) {
          newEnd = originalEnd + lengthDiff;
        } else if (originalEnd > startIndex) {
          newEnd = startIndex + replacement.length;
        }

        element.setSelectionRange(newStart, newEnd);
      }

      logger.info('Text replaced using setRangeText');
      return true;
    }

    // For contenteditable elements
    if (element.isContentEditable) {
      const range = createRangeForOffsets(element, startIndex, endIndex);

      if (range) {
        range.deleteContents();

        if (replacement.length > 0) {
          const newTextNode = document.createTextNode(replacement);
          range.insertNode(newTextNode);
          range.setStartAfter(newTextNode);
        }

        range.collapse(true);

        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        element.normalize();
        element.dispatchEvent(new Event('input', { bubbles: true }));

        logger.info('Text replaced using Selection/Range API');
        return true;
      }

      logger.warn('Unable to resolve range for replacement');
      const text = element.textContent || '';
      element.textContent = text.substring(0, startIndex) + replacement + text.substring(endIndex);
      element.normalize();
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return false;
    }

    return false;
  } catch (error) {
    logger.error({ error }, 'Failed to replace text');
    return false;
  }
}

/**
 * Helper function to find the text node and offsets for a given range in a contenteditable element.
 */
const createRangeForOffsets = (
  element: HTMLElement,
  startIndex: number,
  endIndex: number
): Range | null => {
  const start = resolveTextPosition(element, startIndex);
  const end = resolveTextPosition(element, endIndex);

  if (!start || !end) {
    return null;
  }

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
};

interface TextPosition {
  node: Text;
  offset: number;
}

const resolveTextPosition = (element: HTMLElement, index: number): TextPosition | null => {
  let remaining = index;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode() as Text | null;

  while (textNode) {
    const length = textNode.textContent?.length ?? 0;
    if (remaining <= length) {
      return { node: textNode, offset: remaining };
    }
    remaining -= length;
    textNode = walker.nextNode() as Text | null;
  }

  const lastText = getLastTextNode(element);
  if (!lastText) {
    return null;
  }

  return { node: lastText, offset: lastText.textContent?.length ?? 0 };
};

const getLastTextNode = (element: HTMLElement): Text | null => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  let current: Text | null;
  while ((current = walker.nextNode() as Text | null)) {
    last = current;
  }
  return last;
};
