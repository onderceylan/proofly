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

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

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
  normalize() {}
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

class FakeText {
  nodeType = TEXT_NODE;
  textContent: string;
  childNodes: never[] = [];
  get length() {
    return this.textContent.length;
  }
  constructor(data: string) {
    this.textContent = data;
  }
}

class FakeElement {
  nodeType = ELEMENT_NODE;
  tagName: string;
  childNodes: (FakeElement | FakeText)[] = [];
  isContentEditable = false;
  private listeners = new Map<string, ((event: MockEvent) => void)[]>();

  get textContent(): string {
    return this.childNodes
      .map((c) => c.textContent)
      .filter(Boolean)
      .join('');
  }
  set textContent(value: string) {
    this.childNodes = [new FakeText(value)];
  }

  constructor(tag: string, children: (FakeElement | FakeText)[] = []) {
    this.tagName = tag.toUpperCase();
    this.childNodes = children;
  }

  focus() {}
  normalize() {}

  addEventListener(event: string, handler: (e: MockEvent) => void) {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  dispatchEvent(event: MockEvent) {
    this.listeners.get(event.type)?.forEach((handler) => handler(event));
    return true;
  }
}

const globalAny = globalThis as any;

describe('replaceTextWithUndo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalAny.Event = MockEvent;
    globalAny.Node = { TEXT_NODE, ELEMENT_NODE };
    globalAny.HTMLElement = MockHTMLElement;
    globalAny.HTMLTextAreaElement = MockTextAreaElement;
    globalAny.HTMLInputElement = class extends MockTextAreaElement {};
    globalAny.NodeFilter = { SHOW_TEXT: 4 };
    globalAny.document = {
      createTreeWalker: () => ({
        nextNode: () => null,
      }),
      createTextNode: (text: string) => new FakeText(text),
      createRange: () => new MockRange(),
    };
    globalAny.window = {
      getSelection: () => ({ removeAllRanges: vi.fn(), addRange: vi.fn() }),
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

  it('uses block-aware offsets for contenteditable with paragraphs', () => {
    const t1 = new FakeText('First.');
    const t2 = new FakeText('Second.');
    const root = new FakeElement('div', [new FakeElement('p', [t1]), new FakeElement('p', [t2])]);
    root.isContentEditable = true;

    // Virtual text: "First.\nSecond." (length 14)
    // "Second" starts at index 7, ends at 13
    // Replace "Second" (index 7..13) with "2nd"
    const rangeOps = mockRangeCapture();
    const result = replaceTextWithUndo(root as unknown as HTMLElement, 7, 13, '2nd');

    expect(result).toBe(true);
    expect(rangeOps.setStartArgs).toEqual([t2, 0]);
    expect(rangeOps.setEndArgs).toEqual([t2, 6]);
    expect(logger.info).toHaveBeenCalledWith('Text replaced using Selection/Range API');
  });

  it('resolves offsets correctly across block boundary for contenteditable', () => {
    const t1 = new FakeText('AAA');
    const t2 = new FakeText('BBB');
    const t3 = new FakeText('CCC');
    const root = new FakeElement('div', [
      new FakeElement('li', [t1]),
      new FakeElement('li', [t2]),
      new FakeElement('li', [t3]),
    ]);
    root.isContentEditable = true;

    // Virtual text: "AAA\nBBB\nCCC" (length 11)
    // Replace "BBB" at index 4..7
    const rangeOps = mockRangeCapture();
    replaceTextWithUndo(root as unknown as HTMLElement, 4, 7, 'DDD');

    expect(rangeOps.setStartArgs).toEqual([t2, 0]);
    expect(rangeOps.setEndArgs).toEqual([t2, 3]);
  });

  it('fallback path uses block-aware text extraction', () => {
    const element = new MockHTMLElement();
    element.isContentEditable = true;
    element.textContent = 'AB\nCD';
    const result = replaceTextWithUndo(element as unknown as HTMLElement, 3, 5, 'EF');
    expect(result).toBe(false);
    expect(element.textContent).toBe('AB\nEF');
  });
});

class MockRange {
  startNode: unknown = null;
  startOffset = 0;
  endNode: unknown = null;
  endOffset = 0;

  setStart(node: unknown, offset: number) {
    this.startNode = node;
    this.startOffset = offset;
  }

  setEnd(node: unknown, offset: number) {
    this.endNode = node;
    this.endOffset = offset;
  }

  deleteContents() {}
  insertNode() {}
  setStartAfter() {}
  collapse() {}
}

function mockRangeCapture() {
  const ops = {
    setStartArgs: null as [unknown, number] | null,
    setEndArgs: null as [unknown, number] | null,
  };

  globalAny.document.createRange = () => {
    const range = new MockRange();
    const origSetStart = range.setStart.bind(range);
    const origSetEnd = range.setEnd.bind(range);
    range.setStart = (node: unknown, offset: number) => {
      ops.setStartArgs = [node, offset];
      origSetStart(node, offset);
    };
    range.setEnd = (node: unknown, offset: number) => {
      ops.setEndArgs = [node, offset];
      origSetEnd(node, offset);
    };
    return range;
  };

  return ops;
}
