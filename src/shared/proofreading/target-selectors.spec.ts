import { beforeEach, describe, expect, it } from 'vitest';

import {
  isAutocorrectDisabled,
  isProofreadTarget,
  isSpellcheckDisabled,
  isTextInput,
  isWritingSuggestionsDisabled,
  shouldMirrorOnElement,
  shouldProofread,
} from './target-selectors.ts';

class MockElement {
  tagName: string;
  attributes = new Map<string, string>();
  isContentEditable = false;
  parentElement: MockElement | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  matches(selector: string) {
    return selector.split(',').some((raw) => this.matchesSingle(raw.trim()));
  }

  closest(selector: string) {
    let current: MockElement | null = this;
    while (current) {
      if (current.matches(selector)) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  private matchesSingle(selector: string) {
    if (selector === 'textarea') {
      return this.tagName === 'TEXTAREA';
    }
    if (selector === 'input:not([type])') {
      return this.tagName === 'INPUT' && !this.getAttribute('type');
    }
    if (selector === 'input[type="text"]') {
      return this.tagName === 'INPUT' && this.getAttribute('type')?.toLowerCase() === 'text';
    }
    if (selector === '[contenteditable]:not([contenteditable="false"])') {
      const attr = this.getAttribute('contenteditable');
      return this.isContentEditable && attr?.toLowerCase() !== 'false';
    }
    if (selector === '[spellcheck="false"]') {
      return this.getAttribute('spellcheck')?.toLowerCase() === 'false';
    }
    return false;
  }
}

class MockInputElement extends MockElement {
  constructor() {
    super('input');
  }
}

class MockTextareaElement extends MockElement {
  constructor() {
    super('textarea');
  }
}

const globalAny = globalThis as any;

describe('proofread target selectors', () => {
  beforeEach(() => {
    globalAny.HTMLElement = MockElement;
    globalAny.Element = MockElement;
    globalAny.HTMLInputElement = MockInputElement;
    globalAny.HTMLTextAreaElement = MockTextareaElement;
  });

  it('identifies valid proofreading targets', () => {
    const textarea = new MockTextareaElement();
    expect(isProofreadTarget(textarea as unknown as Element)).toBe(true);

    const input = new MockInputElement();
    expect(isProofreadTarget(input as unknown as Element)).toBe(true);

    const contentEditable = new MockElement('div');
    contentEditable.isContentEditable = true;
    expect(isProofreadTarget(contentEditable as unknown as Element)).toBe(true);

    const other = new MockElement('span');
    expect(isProofreadTarget(other as unknown as Element)).toBe(false);
  });

  it('checks spellcheck/autocorrect/writing suggestions attributes', () => {
    const el = new MockElement('textarea');
    expect(isSpellcheckDisabled(el as unknown as Element)).toBe(false);
    el.setAttribute('spellcheck', 'false');
    expect(isSpellcheckDisabled(el as unknown as Element)).toBe(true);

    el.setAttribute('autocorrect', 'off');
    expect(isAutocorrectDisabled(el as unknown as Element)).toBe(true);

    el.setAttribute('writingsuggestions', 'false');
    expect(isWritingSuggestionsDisabled(el as unknown as Element)).toBe(true);
  });

  it('determines when an element should be proofread', () => {
    const el = new MockElement('textarea');
    expect(shouldProofread(el as unknown as Element)).toBe(true);
    el.setAttribute('spellcheck', 'false');
    expect(shouldProofread(el as unknown as Element)).toBe(false);
  });

  it('ignores elements when a spellcheck-disabled ancestor exists', () => {
    const wrapper = new MockElement('div');
    wrapper.setAttribute('spellcheck', 'false');

    const child = new MockElement('textarea');
    child.parentElement = wrapper;

    expect(shouldProofread(child as unknown as Element)).toBe(false);
  });

  it('detects mirror candidates and text inputs', () => {
    const textarea = new MockTextareaElement();
    const input = new MockInputElement();
    input.setAttribute('type', 'text');

    expect(shouldMirrorOnElement(textarea as unknown as Element)).toBe(true);
    expect(shouldMirrorOnElement(input as unknown as Element)).toBe(true);
    expect(isTextInput(input as unknown as Element)).toBe(true);

    const otherInput = new MockInputElement();
    otherInput.setAttribute('type', 'email');
    expect(isTextInput(otherInput as unknown as Element)).toBe(false);
  });
});
