import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ElementTracker } from './element-tracker.ts';

vi.mock('../../shared/proofreading/target-selectors.ts', () => ({
  isProofreadTarget: vi.fn((element: HTMLElement) => {
    const tag = element.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || element.isContentEditable;
  }),
  shouldAutoProofread: vi.fn((element: HTMLElement) => {
    const tag = element.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || element.isContentEditable;
  }),
  isSpellcheckDisabled: vi.fn(() => false),
}));

function createMockElement(tagName: string, isContentEditable = false): HTMLElement {
  return {
    tagName: tagName.toUpperCase(),
    isContentEditable,
    nodeType: 1,
    parentElement: null,
    closest: vi.fn(() => null),
  } as unknown as HTMLElement;
}

describe('ElementTracker', () => {
  let tracker: ElementTracker;
  let events: {
    onElementAdded?: (element: HTMLElement) => void;
    onElementRemoved?: (element: HTMLElement) => void;
    onElementFocused?: (element: HTMLElement) => void;
    onElementBlurred?: (element: HTMLElement) => void;
    onElementInput?: (element: HTMLElement) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    events = {
      onElementAdded: vi.fn(),
      onElementRemoved: vi.fn(),
      onElementFocused: vi.fn(),
      onElementBlurred: vi.fn(),
      onElementInput: vi.fn(),
    };
    tracker = new ElementTracker(events);
  });

  describe('registerElement', () => {
    it('should register a new element', () => {
      const element = createMockElement('input');
      tracker.registerElement(element);

      expect(tracker.isRegistered(element)).toBe(true);
    });

    it('should not register the same element twice', () => {
      const element = createMockElement('input');
      tracker.registerElement(element);
      tracker.registerElement(element);

      expect(tracker.isRegistered(element)).toBe(true);
    });

    it('should assign unique ID to registered element', () => {
      const element1 = createMockElement('input');
      const element2 = createMockElement('textarea');

      tracker.registerElement(element1);
      tracker.registerElement(element2);

      const id1 = tracker.getElementId(element1);
      const id2 = tracker.getElementId(element2);

      expect(id1).toBeTruthy();
      expect(id2).toBeTruthy();
      expect(id1).not.toBe(id2);
    });
  });

  describe('unregisterElement', () => {
    it('should unregister an element', () => {
      const element = createMockElement('input');
      tracker.registerElement(element);
      tracker.unregisterElement(element);

      expect(tracker.isRegistered(element)).toBe(false);
    });

    it('should clear active element when unregistering it', () => {
      const element = createMockElement('input');
      tracker.registerElement(element);
      (tracker as any).activeElement = element;

      tracker.unregisterElement(element);

      expect(tracker.getActiveElement()).toBeNull();
    });
  });

  describe('getElementId', () => {
    it('should return element ID', () => {
      const element = createMockElement('input');
      tracker.registerElement(element);

      const id = tracker.getElementId(element);
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
    });

    it('should return same ID for same element', () => {
      const element = createMockElement('input');
      const id1 = tracker.getElementId(element);
      const id2 = tracker.getElementId(element);

      expect(id1).toBe(id2);
    });
  });

  describe('getElementById', () => {
    it('should retrieve element by ID', () => {
      const element = createMockElement('input');
      tracker.registerElement(element);
      const id = tracker.getElementId(element);

      const retrieved = tracker.getElementById(id);
      expect(retrieved).toBe(element);
    });

    it('should return undefined for unknown ID', () => {
      const retrieved = tracker.getElementById('unknown-id');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('isProofreadTarget', () => {
    it('should identify input as proofread target', () => {
      const element = createMockElement('input');
      expect(tracker.isProofreadTarget(element)).toBe(true);
    });

    it('should identify textarea as proofread target', () => {
      const element = createMockElement('textarea');
      expect(tracker.isProofreadTarget(element)).toBe(true);
    });

    it('should identify contenteditable as proofread target', () => {
      const element = createMockElement('div', true);
      expect(tracker.isProofreadTarget(element)).toBe(true);
    });
  });

  describe('shouldAutoProofread', () => {
    it('should return true for valid proofread targets', () => {
      const element = createMockElement('input');
      expect(tracker.shouldAutoProofread(element)).toBe(true);
    });
  });

  describe('resolveAutoProofreadIgnoreReason', () => {
    it('should return spellcheck-disabled for elements with spellcheck disabled', async () => {
      const { isSpellcheckDisabled } = await import(
        '../../shared/proofreading/target-selectors.ts'
      );
      vi.mocked(isSpellcheckDisabled).mockReturnValueOnce(true);

      const element = createMockElement('input');
      const reason = tracker.resolveAutoProofreadIgnoreReason(element);

      expect(reason).toBe('spellcheck-disabled');
    });

    it('should return spellcheck-disabled for elements with ancestor having spellcheck disabled', () => {
      const element = createMockElement('input');
      element.closest = vi.fn(() => ({}) as HTMLElement);

      const reason = tracker.resolveAutoProofreadIgnoreReason(element);

      expect(reason).toBe('spellcheck-disabled');
    });

    it('should return unsupported-target as fallback', () => {
      const element = createMockElement('input');
      const reason = tracker.resolveAutoProofreadIgnoreReason(element);

      expect(reason).toBe('unsupported-target');
    });
  });

  describe('destroy', () => {
    it('should clear all registered elements', () => {
      const element1 = createMockElement('input');
      const element2 = createMockElement('textarea');

      tracker.registerElement(element1);
      tracker.registerElement(element2);

      tracker.destroy();

      expect(tracker.isRegistered(element1)).toBe(false);
      expect(tracker.isRegistered(element2)).toBe(false);
    });

    it('should clear active element', () => {
      const element = createMockElement('input');
      (tracker as any).activeElement = element;

      tracker.destroy();

      expect(tracker.getActiveElement()).toBeNull();
    });
  });
});
