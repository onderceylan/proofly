import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeIssueLabel, resolveElementKind, toSidepanelIssue } from './issues.ts';

class MockDocument {
  private elements = new Map<string, MockHTMLElement>();

  register(element: MockHTMLElement) {
    if (element.id) {
      this.elements.set(element.id, element);
    }
    element.ownerDocument = this as unknown as Document;
  }

  getElementById(id: string): MockHTMLElement | null {
    return this.elements.get(id) ?? null;
  }
}

class MockHTMLElement {
  tagName: string;
  textContent: string | null = null;
  parentElement: MockHTMLElement | null = null;
  ownerDocument: Document | null = null;
  id = '';
  attributes = new Map<string, string>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child: MockHTMLElement) {
    child.parentElement = this;
    if (child.id && this.ownerDocument) {
      (this.ownerDocument as unknown as MockDocument).register(child);
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  closest(selector: string) {
    if (selector === 'label') {
      let node: MockHTMLElement | null = this.parentElement;
      while (node) {
        if (node.tagName === 'LABEL') return node;
        node = node.parentElement;
      }
    }
    return null;
  }
}

class MockHTMLInputElement extends MockHTMLElement {}
class MockHTMLTextAreaElement extends MockHTMLElement {}
class MockHTMLSelectElement extends MockHTMLElement {}
class MockHTMLLabelElement extends MockHTMLElement {
  constructor() {
    super('label');
  }
}

const globalAny = globalThis as any;

describe('issue helpers', () => {
  beforeEach(() => {
    globalAny.HTMLElement = MockHTMLElement;
    globalAny.Element = MockHTMLElement;
    globalAny.HTMLInputElement = MockHTMLInputElement;
    globalAny.HTMLTextAreaElement = MockHTMLTextAreaElement;
    globalAny.HTMLSelectElement = MockHTMLSelectElement;
    globalAny.HTMLLabelElement = MockHTMLLabelElement;
  });

  it('converts proofread corrections to sidepanel issues', () => {
    const issue = toSidepanelIssue(
      'el-1',
      { startIndex: 0, endIndex: 3, correction: 'Fix', type: 'spelling', explanation: 'oops' },
      'bad',
      'issue-1'
    );
    expect(issue).toMatchObject({
      id: 'issue-1',
      elementId: 'el-1',
      replacementText: 'Fix',
      type: 'spelling',
      explanation: 'oops',
    });
  });

  it('resolves label text from associated <label>', () => {
    const doc = new MockDocument();
    const input = new MockHTMLInputElement('input');
    input.ownerDocument = doc as unknown as Document;
    const label = new MockHTMLLabelElement();
    label.textContent = 'Email';
    Object.defineProperty(input, 'labels', {
      value: [label],
      configurable: true,
    });
    expect(normalizeIssueLabel(input as unknown as HTMLElement)).toBe('Email');
  });

  it('uses aria-labelledby references when present', () => {
    const doc = new MockDocument();
    const label = new MockHTMLLabelElement();
    label.id = 'lbl';
    label.textContent = 'Full Name';
    doc.register(label);
    const input = new MockHTMLInputElement('input');
    input.ownerDocument = doc as unknown as Document;
    input.setAttribute('aria-labelledby', 'lbl');
    expect(normalizeIssueLabel(input as unknown as HTMLElement)).toBe('Full Name');
  });

  it('falls back to aria-label and closest label text', () => {
    const doc = new MockDocument();
    const input = new MockHTMLInputElement('input');
    input.ownerDocument = doc as unknown as Document;
    input.setAttribute('aria-label', 'Nickname');
    expect(normalizeIssueLabel(input as unknown as HTMLElement)).toBe('Nickname');

    input.attributes.delete('aria-label');
    const wrapper = new MockHTMLLabelElement();
    wrapper.textContent = 'Wrapped Label';
    wrapper.appendChild(input);
    expect(normalizeIssueLabel(input as unknown as HTMLElement)).toBe('Wrapped Label');
  });

  it('returns null when no labels exist', () => {
    const element = new MockHTMLElement('div');
    expect(normalizeIssueLabel(element as unknown as HTMLElement)).toBeNull();
  });

  it('resolves element kind constants', () => {
    expect(resolveElementKind(new MockHTMLInputElement('input') as unknown as HTMLElement)).toBe(
      'input'
    );
    expect(
      resolveElementKind(new MockHTMLTextAreaElement('textarea') as unknown as HTMLElement)
    ).toBe('textarea');
    expect(resolveElementKind(new MockHTMLElement('div') as unknown as HTMLElement)).toBe(
      'contenteditable'
    );
  });
});
