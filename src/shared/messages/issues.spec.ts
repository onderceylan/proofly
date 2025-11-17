import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeIssueLabel, resolveElementKind, toSidepanelIssue } from './issues.ts';
import {
  createMockDocument,
  MockHTMLInputElement,
  MockHTMLLabelElement,
  MockHTMLTextAreaElement,
  MockHTMLElement,
  registerGlobalDomMocks,
} from '../../test/helpers/mock-dom.ts';

describe('issue helpers', () => {
  beforeEach(() => {
    registerGlobalDomMocks();
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
    const doc = createMockDocument();
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
    const doc = createMockDocument();
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
    const doc = createMockDocument();
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
