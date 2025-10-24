/**
 * Custom Undo Manager for maintaining undo/redo history
 * without using deprecated execCommand API.
 *
 * This manager tracks text changes and cursor positions for both
 * textarea/input and contenteditable elements.
 */

import { logger } from '../../services/logger.ts';

interface UndoState<T = unknown> {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  metadata?: T;
}

interface ElementUndoHistory<T = unknown> {
  undoStack: UndoState<T>[];
  redoStack: UndoState<T>[];
  maxStackSize: number;
  onStateRestore?: (metadata?: T) => void;
  keydownHandler?: (event: KeyboardEvent) => void;
}

export class UndoManager {
  private histories = new Map<HTMLElement, ElementUndoHistory>();
  private readonly maxStackSize = 100;

  /**
   * Initializes undo tracking for an element
   */
  initElement(element: HTMLElement, onStateRestore?: (metadata?: unknown) => void): void {
    if (this.histories.has(element)) {
      const history = this.histories.get(element);
      if (history && onStateRestore) {
        history.onStateRestore = onStateRestore;
      }
      return;
    }

    const history: ElementUndoHistory = {
      undoStack: [],
      redoStack: [],
      maxStackSize: this.maxStackSize,
      onStateRestore,
    };

    this.histories.set(element, history);

    // Save initial state
    this.saveState(element);

    // Set up keyboard shortcuts for undo/redo
    history.keydownHandler = this.setupKeyboardShortcuts(element);

    logger.info('Undo manager initialized for element');
  }

  /**
   * Saves current state to undo stack before making changes
   */
  saveState(element: HTMLElement, metadata?: unknown): void {
    const history = this.histories.get(element);
    if (!history) return;

    const state = this.captureState(element, metadata);
    if (!state) return;

    // Don't save duplicate states
    const lastState = history.undoStack[history.undoStack.length - 1];
    if (lastState && this.statesEqual(lastState, state)) {
      return;
    }

    history.undoStack.push(state);

    // Limit stack size
    if (history.undoStack.length > history.maxStackSize) {
      history.undoStack.shift();
    }

    // Clear redo stack when new change is made
    history.redoStack = [];

    logger.info(`Undo state saved. Stack size: ${history.undoStack.length}`);
  }

  /**
   * Checks if the given text matches any state in the history
   */
  hasStateForText(element: HTMLElement, text: string): boolean {
    const history = this.histories.get(element);
    if (!history) return false;

    return [...history.undoStack, ...history.redoStack].some((state) => state.text === text);
  }

  /**
   * Gets the metadata for a specific text state, if it exists
   */
  getMetadataForText(element: HTMLElement, text: string): unknown | undefined {
    const history = this.histories.get(element);
    if (!history) return undefined;

    const combined = [...history.undoStack, ...history.redoStack];
    for (let i = combined.length - 1; i >= 0; i -= 1) {
      if (combined[i].text === text) {
        return combined[i].metadata;
      }
    }

    return undefined;
  }

  /**
   * Undoes the last change
   */
  undo(element: HTMLElement): boolean {
    const history = this.histories.get(element);
    if (!history || history.undoStack.length <= 1) {
      logger.info('Nothing to undo');
      return false;
    }

    // Pop the current state and move it to redo stack (preserving metadata)
    const currentState = history.undoStack.pop();
    if (currentState) {
      history.redoStack.push(currentState);
    }

    // Get the previous state
    const previousState = history.undoStack[history.undoStack.length - 1];
    if (!previousState) {
      return false;
    }

    // Restore previous state
    this.restoreState(element, previousState, history);

    logger.info('Undo performed');
    return true;
  }

  /**
   * Redoes the last undone change
   */
  redo(element: HTMLElement): boolean {
    const history = this.histories.get(element);
    if (!history || history.redoStack.length === 0) {
      logger.info('Nothing to redo');
      return false;
    }

    // Pop the next state from redo stack and push to undo stack (preserving metadata)
    const nextState = history.redoStack.pop();
    if (!nextState) {
      return false;
    }

    history.undoStack.push(nextState);

    // Restore next state
    this.restoreState(element, nextState, history);

    logger.info('Redo performed');
    return true;
  }

  /**
   * Captures the current state of an element
   */
  private captureState(element: HTMLElement, metadata?: unknown): UndoState | null {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return {
        text: element.value,
        selectionStart: element.selectionStart || 0,
        selectionEnd: element.selectionEnd || 0,
        metadata,
      };
    }

    if (element.isContentEditable) {
      const selection = window.getSelection();
      let selectionStart = 0;
      let selectionEnd = 0;

      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        selectionStart = this.getTextOffset(element, range.startContainer, range.startOffset);
        selectionEnd = this.getTextOffset(element, range.endContainer, range.endOffset);
      }

      return {
        text: element.textContent || '',
        selectionStart,
        selectionEnd,
        metadata,
      };
    }

    return null;
  }

  /**
   * Restores an element to a previous state
   */
  private restoreState(element: HTMLElement, state: UndoState, history: ElementUndoHistory): void {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      element.value = state.text;
      element.setSelectionRange(state.selectionStart, state.selectionEnd);

      // Trigger callback with metadata BEFORE dispatching input event
      // This allows the callback to set flags and restore highlights on the correct DOM
      if (history.onStateRestore) {
        history.onStateRestore(state.metadata);
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (element.isContentEditable) {
      // First, restore the text content
      element.textContent = state.text;

      // Normalize the element to merge adjacent text nodes
      // This is crucial for subsequent highlighting to work correctly
      element.normalize();

      // Restore selection
      const textNode = this.getFirstTextNode(element);
      if (textNode) {
        const range = document.createRange();
        const selection = window.getSelection();

        try {
          range.setStart(textNode, Math.min(state.selectionStart, textNode.length));
          range.setEnd(textNode, Math.min(state.selectionEnd, textNode.length));

          selection?.removeAllRanges();
          selection?.addRange(range);
        } catch (error) {
          logger.warn({ error }, 'Failed to restore selection');
        }
      }

      // Trigger callback with metadata AFTER restoring text and normalizing,
      // but BEFORE dispatching input event. This allows the callback to:
      // 1. Set flags (like isRestoringFromHistory)
      // 2. Restore highlights on the correct normalized DOM
      if (history.onStateRestore) {
        history.onStateRestore(state.metadata);
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /**
   * Gets the text offset for a given node and offset within a contenteditable element
   */
  private getTextOffset(root: HTMLElement, node: Node, offset: number): number {
    let textOffset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);

    let currentNode: Node | null;
    while ((currentNode = walker.nextNode())) {
      if (currentNode === node) {
        return textOffset + offset;
      }
      textOffset += currentNode.textContent?.length || 0;
    }

    return textOffset;
  }

  /**
   * Gets the first text node in an element
   */
  private getFirstTextNode(element: HTMLElement): Text | null {
    if (element.firstChild && element.firstChild.nodeType === Node.TEXT_NODE) {
      return element.firstChild as Text;
    }

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    return walker.nextNode() as Text | null;
  }

  /**
   * Checks if two states are equal
   */
  private statesEqual(state1: UndoState, state2: UndoState): boolean {
    const metadataEqual =
      state1.metadata === state2.metadata ||
      (state1.metadata === undefined && state2.metadata === undefined);

    return (
      state1.text === state2.text &&
      state1.selectionStart === state2.selectionStart &&
      state1.selectionEnd === state2.selectionEnd &&
      metadataEqual
    );
  }

  /**
   * Sets up keyboard shortcuts for undo/redo
   */
  private setupKeyboardShortcuts(element: HTMLElement): (event: KeyboardEvent) => void {
    const handleKeydown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      // Undo: Ctrl+Z (or Cmd+Z on Mac)
      if (ctrlKey && e.key === 'z' && !e.shiftKey) {
        if (this.undo(element)) {
          e.preventDefault();
        }
      }

      // Redo: Ctrl+Shift+Z or Ctrl+Y (or Cmd+Shift+Z on Mac)
      if ((ctrlKey && e.key === 'z' && e.shiftKey) || (ctrlKey && e.key === 'y')) {
        if (this.redo(element)) {
          e.preventDefault();
        }
      }
    };

    element.addEventListener('keydown', handleKeydown);

    return handleKeydown;
  }

  disposeElement(element: HTMLElement): void {
    const history = this.histories.get(element);
    if (!history) {
      return;
    }

    if (history.keydownHandler) {
      element.removeEventListener('keydown', history.keydownHandler);
    }

    this.histories.delete(element);
  }

  resetHistory(element: HTMLElement, metadata?: unknown): void {
    const history = this.histories.get(element);
    if (!history) {
      return;
    }

    history.undoStack = [];
    history.redoStack = [];

    const initialState = this.captureState(element, metadata);
    if (initialState) {
      history.undoStack.push(initialState);
    }
  }

}

// Create a singleton instance
export const undoManager = new UndoManager();
