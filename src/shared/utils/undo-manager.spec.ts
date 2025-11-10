import { beforeEach, describe, expect, it, vi } from 'vitest';
import { undoManager } from './undo-manager.ts';

vi.mock('../../services/logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./platform.ts', () => ({
  isMacOS: vi.fn(() => false),
}));

class MockEvent {
  constructor(public type: string) {}
}

class MockHTMLElement {
  listeners = new Map<string, ((event: MockEvent | KeyboardEvent) => void)[]>();

  addEventListener(type: string, handler: (event: any) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, handler: (event: any) => void) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((fn) => fn !== handler)
    );
  }

  dispatchEvent(event: MockEvent) {
    this.listeners.get(event.type)?.forEach((fn) => fn(event));
    return true;
  }
}

class MockTextAreaElement extends MockHTMLElement {
  tagName = 'TEXTAREA';
  value: string;
  selectionStart: number;
  selectionEnd: number;

  constructor(value: string) {
    super();
    this.value = value;
    this.selectionStart = 0;
    this.selectionEnd = value.length;
  }

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

const globalAny = globalThis as any;

describe('undo manager', () => {
  beforeEach(() => {
    globalAny.Event = MockEvent;
    globalAny.HTMLElement = MockHTMLElement;
    globalAny.HTMLTextAreaElement = MockTextAreaElement;
    globalAny.HTMLInputElement = MockTextAreaElement;
    (undoManager as any).histories = new Map();
  });

  it('initializes element history and performs undo/redo', () => {
    const element = new MockTextAreaElement('Hello');
    const restoreSpy = vi.fn();

    undoManager.initElement(element as unknown as HTMLTextAreaElement, restoreSpy);

    element.value = 'Hello world';
    element.selectionStart = element.selectionEnd = element.value.length;
    undoManager.saveState(element as unknown as HTMLTextAreaElement, { reason: 'edit' });
    expect(undoManager.hasStateForText(element as unknown as HTMLElement, 'Hello world')).toBe(
      true
    );
    expect(
      undoManager.getMetadataForText(element as unknown as HTMLElement, 'Hello world')
    ).toEqual({ reason: 'edit' });

    expect(undoManager.undo(element as unknown as HTMLElement)).toBe(true);
    expect(element.value).toBe('Hello');
    expect(restoreSpy).toHaveBeenCalled();

    expect(undoManager.redo(element as unknown as HTMLElement)).toBe(true);
    expect(element.value).toBe('Hello world');
  });

  it('ignores duplicate states and resets history', () => {
    const element = new MockTextAreaElement('abc');
    undoManager.initElement(element as unknown as HTMLTextAreaElement);
    undoManager.saveState(element as unknown as HTMLTextAreaElement);
    undoManager.saveState(element as unknown as HTMLTextAreaElement);

    undoManager.resetHistory(element as unknown as HTMLElement, { seed: true });
    expect(undoManager.hasStateForText(element as unknown as HTMLElement, 'abc')).toBe(true);
  });

  it('disposes element listeners and handles keyboard shortcuts', () => {
    const element = new MockTextAreaElement('first');
    const removeSpy = vi.spyOn(element, 'removeEventListener');

    undoManager.initElement(element as unknown as HTMLTextAreaElement);
    element.value = 'second';
    undoManager.saveState(element as unknown as HTMLTextAreaElement);

    const keyHandler = element.listeners.get('keydown')?.[0];
    expect(keyHandler).toBeDefined();

    keyHandler?.({
      key: 'z',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);
    expect(element.value).toBe('first');

    undoManager.disposeElement(element as unknown as HTMLElement);
    expect(removeSpy).toHaveBeenCalledWith('keydown', keyHandler);
  });
});
