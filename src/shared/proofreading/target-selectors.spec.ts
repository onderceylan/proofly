import { beforeEach, describe, expect, it } from 'vitest';

import {
  isAutocorrectDisabled,
  isProofreadTarget,
  isSpellcheckDisabled,
  isTextInput,
  isWritingSuggestionsDisabled,
  shouldMirrorOnElement,
  shouldAutoProofread,
  isUsernameField,
  isOneTimeCodeField,
  isNumericField,
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

  closest(selector: string): MockElement | null {
    if (this.matches(selector)) {
      return this;
    }

    return this.parentElement ? this.parentElement.closest(selector) : null;
  }

  private matchesSingle(selector: string) {
    if (selector === 'textarea:not([role="textbox"])') {
      if (this.tagName !== 'TEXTAREA') {
        return false;
      }
      const role = this.getAttribute('role');
      return !(typeof role === 'string' && role.trim().toLowerCase() === 'textbox');
    }
    if (selector === '[role="textbox"]') {
      const role = this.getAttribute('role');
      return typeof role === 'string' && role.trim().toLowerCase() === 'textbox';
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
    expect(shouldAutoProofread(el as unknown as Element)).toBe(true);
    el.setAttribute('spellcheck', 'false');
    expect(shouldAutoProofread(el as unknown as Element)).toBe(false);
  });

  it('ignores elements when a spellcheck-disabled ancestor exists', () => {
    const wrapper = new MockElement('div');
    wrapper.setAttribute('spellcheck', 'false');

    const child = new MockElement('textarea');
    child.parentElement = wrapper;

    expect(shouldAutoProofread(child as unknown as Element)).toBe(false);
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

  it('ignores username fields', () => {
    const el = new MockElement('input');
    expect(isUsernameField(el as unknown as Element)).toBe(false);
    el.setAttribute('autocomplete', 'username');
    expect(isUsernameField(el as unknown as Element)).toBe(true);
    expect(shouldAutoProofread(el as unknown as Element)).toBe(false);
  });

  it('ignores one-time-code fields', () => {
    const el = new MockElement('input');
    expect(isOneTimeCodeField(el as unknown as Element)).toBe(false);
    el.setAttribute('autocomplete', 'one-time-code');
    expect(isOneTimeCodeField(el as unknown as Element)).toBe(true);
    expect(shouldAutoProofread(el as unknown as Element)).toBe(false);
  });

  it('ignores numeric fields', () => {
    const el = new MockElement('input');
    expect(isNumericField(el as unknown as Element)).toBe(false);
    el.setAttribute('inputmode', 'numeric');
    expect(isNumericField(el as unknown as Element)).toBe(true);
    expect(shouldAutoProofread(el as unknown as Element)).toBe(false);
  });
});
