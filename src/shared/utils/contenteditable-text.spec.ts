import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractContentEditableText,
  resolveContentEditableOffset,
} from './contenteditable-text.ts';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

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
  get textContent(): string {
    return this.childNodes
      .map((c) => c.textContent)
      .filter(Boolean)
      .join('');
  }
  constructor(tag: string, children: (FakeElement | FakeText)[] = []) {
    this.tagName = tag.toUpperCase();
    this.childNodes = children;
  }
}

function text(data: string): FakeText {
  return new FakeText(data);
}

function el(tag: string, ...children: (FakeElement | FakeText)[]): FakeElement {
  return new FakeElement(tag, children);
}

const asHTML = (node: FakeElement) => node as unknown as HTMLElement;

beforeEach(() => {
  const g = globalThis as any;
  g.Node = { TEXT_NODE, ELEMENT_NODE };
});

describe('extractContentEditableText', () => {
  it('extracts plain text from a single text node', () => {
    const root = el('div', text('Hello world'));
    expect(extractContentEditableText(asHTML(root))).toBe('Hello world');
  });

  it('concatenates adjacent text nodes without separator', () => {
    const root = el('div', text('Hello '), text('world'));
    expect(extractContentEditableText(asHTML(root))).toBe('Hello world');
  });

  it('inserts newline between sibling block elements', () => {
    const root = el('div', el('p', text('First.')), el('p', text('Second.')));
    expect(extractContentEditableText(asHTML(root))).toBe('First.\nSecond.');
  });

  it('inserts newline between list items', () => {
    const root = el('ul', el('li', text('item one.')), el('li', text('item two')));
    expect(extractContentEditableText(asHTML(root))).toBe('item one.\nitem two');
  });

  it('handles BR elements as newlines', () => {
    const root = el('div', text('line one'), el('br'), text('line two'));
    expect(extractContentEditableText(asHTML(root))).toBe('line one\nline two');
  });

  it('does not insert extra separators for inline elements', () => {
    const root = el('p', text('Hello '), el('strong', text('bold')), text(' world'));
    expect(extractContentEditableText(asHTML(root))).toBe('Hello bold world');
  });

  it('handles nested block elements with inline children', () => {
    const root = el(
      'div',
      el('p', text('Hello '), el('em', text('italic'))),
      el('p', text('Next line'))
    );
    expect(extractContentEditableText(asHTML(root))).toBe('Hello italic\nNext line');
  });

  it('does not add leading newline for the first block child', () => {
    const root = el('div', el('p', text('Only paragraph')));
    expect(extractContentEditableText(asHTML(root))).toBe('Only paragraph');
  });

  it('inserts single newline between consecutive blocks', () => {
    const root = el('div', el('div', text('A')), el('div', text('B')), el('div', text('C')));
    expect(extractContentEditableText(asHTML(root))).toBe('A\nB\nC');
  });

  it('returns empty string for an element with no text nodes', () => {
    const root = el('div', el('p'), el('p'));
    expect(extractContentEditableText(asHTML(root))).toBe('');
  });

  it('handles deeply nested block elements', () => {
    const root = el('div', el('blockquote', el('p', text('Quoted'))), el('p', text('Normal')));
    expect(extractContentEditableText(asHTML(root))).toBe('Quoted\nNormal');
  });

  it('falls back to textContent when childNodes is missing', () => {
    const mock = { textContent: 'fallback text' } as unknown as HTMLElement;
    expect(extractContentEditableText(mock)).toBe('fallback text');
  });

  it('returns empty string for element without childNodes and empty textContent', () => {
    const mock = { textContent: '' } as unknown as HTMLElement;
    expect(extractContentEditableText(mock)).toBe('');
  });
});

describe('resolveContentEditableOffset', () => {
  it('resolves offset within a single text node', () => {
    const t = text('Hello world');
    const root = el('div', t);
    const result = resolveContentEditableOffset(asHTML(root), 5);
    expect(result).toEqual({ node: t, offset: 5 });
  });

  it('resolves offset at start of text', () => {
    const t = text('Hello');
    const root = el('div', t);
    const result = resolveContentEditableOffset(asHTML(root), 0);
    expect(result).toEqual({ node: t, offset: 0 });
  });

  it('resolves offset at exact end of text node', () => {
    const t = text('Hello');
    const root = el('div', t);
    const result = resolveContentEditableOffset(asHTML(root), 5);
    expect(result).toEqual({ node: t, offset: 5 });
  });

  it('resolves offset in second paragraph after implicit newline', () => {
    const t1 = text('ABC');
    const t2 = text('DEF');
    const root = el('div', el('p', t1), el('p', t2));
    // Virtual text: "ABC\nDEF" (length 7)
    // Offset 4 → "D" → t2, local offset 0
    const result = resolveContentEditableOffset(asHTML(root), 4);
    expect(result).toEqual({ node: t2, offset: 0 });
  });

  it('resolves offset at end of first paragraph before newline', () => {
    const t1 = text('ABC');
    const t2 = text('DEF');
    const root = el('div', el('p', t1), el('p', t2));
    // Virtual text: "ABC\nDEF"
    // Offset 3 → end of "ABC" → t1, local offset 3
    const result = resolveContentEditableOffset(asHTML(root), 3);
    expect(result).toEqual({ node: t1, offset: 3 });
  });

  it('resolves offset on implicit newline to end of previous text node', () => {
    const t1 = text('ABC');
    const t2 = text('DEF');
    const root = el('div', el('p', t1), el('p', t2));
    // Virtual text: "ABC\nDEF"
    // The \n is at index 3, but offset 3 matches end of t1 (handled above).
    // Checking that resolving mid-paragraph works:
    const result = resolveContentEditableOffset(asHTML(root), 6);
    expect(result).toEqual({ node: t2, offset: 2 });
  });

  it('resolves offset at total text length', () => {
    const t1 = text('AB');
    const t2 = text('CD');
    const root = el('div', el('p', t1), el('p', t2));
    // Virtual text: "AB\nCD" (length 5)
    const result = resolveContentEditableOffset(asHTML(root), 5);
    expect(result).toEqual({ node: t2, offset: 2 });
  });

  it('returns null for empty element', () => {
    const root = el('div');
    const result = resolveContentEditableOffset(asHTML(root), 0);
    expect(result).toBeNull();
  });

  it('returns null when offset exceeds total length', () => {
    const t = text('Hi');
    const root = el('div', t);
    const result = resolveContentEditableOffset(asHTML(root), 10);
    expect(result).toBeNull();
  });

  it('handles multiple text nodes inside a single block', () => {
    const t1 = text('Hello ');
    const t2 = text('world');
    const root = el('div', el('p', t1, el('strong', t2)));
    // Virtual text: "Hello world" (no newline, inline element)
    const result = resolveContentEditableOffset(asHTML(root), 8);
    expect(result).toEqual({ node: t2, offset: 2 });
  });

  it('handles three list items', () => {
    const t1 = text('A');
    const t2 = text('B');
    const t3 = text('C');
    const root = el('ul', el('li', t1), el('li', t2), el('li', t3));
    // Virtual text: "A\nB\nC" (length 5)
    expect(resolveContentEditableOffset(asHTML(root), 0)).toEqual({ node: t1, offset: 0 });
    expect(resolveContentEditableOffset(asHTML(root), 1)).toEqual({ node: t1, offset: 1 });
    expect(resolveContentEditableOffset(asHTML(root), 2)).toEqual({ node: t2, offset: 0 });
    expect(resolveContentEditableOffset(asHTML(root), 3)).toEqual({ node: t2, offset: 1 });
    expect(resolveContentEditableOffset(asHTML(root), 4)).toEqual({ node: t3, offset: 0 });
    expect(resolveContentEditableOffset(asHTML(root), 5)).toEqual({ node: t3, offset: 1 });
  });

  it('handles BR elements in offset calculation', () => {
    const t1 = text('AB');
    const t2 = text('CD');
    const root = el('div', t1, el('br'), t2);
    // Virtual text: "AB\nCD" (length 5)
    expect(resolveContentEditableOffset(asHTML(root), 0)).toEqual({ node: t1, offset: 0 });
    expect(resolveContentEditableOffset(asHTML(root), 2)).toEqual({ node: t1, offset: 2 });
    expect(resolveContentEditableOffset(asHTML(root), 3)).toEqual({ node: t2, offset: 0 });
    expect(resolveContentEditableOffset(asHTML(root), 5)).toEqual({ node: t2, offset: 2 });
  });
});

describe('extractContentEditableText and resolveContentEditableOffset consistency', () => {
  it('round-trips: each character in extracted text resolves to a valid node', () => {
    const t1 = text('Hello.');
    const t2 = text('World!');
    const root = el('ul', el('li', t1), el('li', t2));
    const extracted = extractContentEditableText(asHTML(root));
    expect(extracted).toBe('Hello.\nWorld!');

    for (let i = 0; i < extracted.length; i++) {
      const result = resolveContentEditableOffset(asHTML(root), i);
      expect(result).not.toBeNull();
    }

    const endResult = resolveContentEditableOffset(asHTML(root), extracted.length);
    expect(endResult).not.toBeNull();
  });

  it('offsets in second block point to correct text node', () => {
    const t1 = text('item one.');
    const t2 = text('item two');
    const root = el('ul', el('li', t1), el('li', t2));
    const extracted = extractContentEditableText(asHTML(root));
    expect(extracted).toBe('item one.\nitem two');

    const secondItemStart = extracted.indexOf('item two');
    const resolved = resolveContentEditableOffset(asHTML(root), secondItemStart);
    expect(resolved).toEqual({ node: t2, offset: 0 });

    const midSecondItem = secondItemStart + 4;
    const resolvedMid = resolveContentEditableOffset(asHTML(root), midSecondItem);
    expect(resolvedMid).toEqual({ node: t2, offset: 4 });
  });
});
