import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../services/logger.ts';
import { replaceTextWithUndo } from './clipboard.ts';

vi.mock('../../services/logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

class MockEvent {
  type: string;
  bubbles: boolean;
  constructor(type: string, init?: { bubbles?: boolean }) {
    this.type = type;
    this.bubbles = Boolean(init?.bubbles);
  }
}

class MockHTMLElement {
  isContentEditable = false;
  textContent = '';
  private listeners = new Map<string, ((event: MockEvent) => void)[]>();

  addEventListener(event: string, handler: (e: MockEvent) => void) {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  dispatchEvent(event: MockEvent) {
    this.listeners.get(event.type)?.forEach((handler) => handler(event));
    return true;
  }

  focus() {}
}

class MockTextAreaElement extends MockHTMLElement {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  inputEvents: MockEvent[] = [];

  constructor(value: string) {
    super();
    this.value = value;
    this.selectionStart = 0;
    this.selectionEnd = value.length;
    this.addEventListener('input', (event) => this.inputEvents.push(event));
  }

  setRangeText(replacement: string, start: number, end: number) {
    this.value = this.value.slice(0, start) + replacement + this.value.slice(end);
    this.selectionStart = start;
    this.selectionEnd = start + replacement.length;
  }

  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

const globalAny = globalThis as any;

describe('replaceTextWithUndo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalAny.Event = MockEvent;
    globalAny.HTMLElement = MockHTMLElement;
    globalAny.HTMLTextAreaElement = MockTextAreaElement;
    globalAny.HTMLInputElement = class extends MockTextAreaElement {};
    globalAny.NodeFilter = { SHOW_TEXT: 4 };
    globalAny.document = {
      createTreeWalker: () => ({
        nextNode: () => null,
      }),
      createTextNode: (text: string) => ({ textContent: text }),
    };
  });

  it('replaces textarea text via setRangeText and restores selection', () => {
    const element = new MockTextAreaElement('Hello world');
    const result = replaceTextWithUndo(element as unknown as HTMLTextAreaElement, 0, 5, 'Hi');

    expect(result).toBe(true);
    expect(element.value).toBe('Hi world');
    expect(element.selectionStart).toBe(0);
    expect(element.inputEvents).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith('Text replaced using setRangeText');
  });

  it('falls back when unable to resolve contenteditable range', () => {
    const element = new MockHTMLElement();
    element.isContentEditable = true;
    element.textContent = 'abc';
    const result = replaceTextWithUndo(element as unknown as HTMLElement, 1, 2, 'Z');
    expect(result).toBe(false);
    expect(element.textContent).toBe('aZc');
  });

  it('returns false for unsupported elements', () => {
    const element = new MockHTMLElement();
    const result = replaceTextWithUndo(element as unknown as HTMLElement, 0, 1, 'x');
    expect(result).toBe(false);
  });
});
