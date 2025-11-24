import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PopoverManager } from './popover-manager.ts';
import type { ContentHighlighter } from '../components/content-highlighter.ts';
import type { ProofreadCorrection } from '../../shared/types.ts';

const mockPopover = {
  show: vi.fn(),
  hide: vi.fn(),
  remove: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

(globalThis as any).document = {
  querySelector: vi.fn(() => null),
  createElement: vi.fn(() => mockPopover),
  body: {
    appendChild: vi.fn(),
  },
};

vi.mock('../components/correction-popover.ts', () => ({
  CorrectionPopover: class {
    show = vi.fn();
    hide = vi.fn();
    remove = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
  },
}));

function createMockHighlighter(): ContentHighlighter {
  return {
    setPopover: vi.fn(),
    clearSelection: vi.fn(),
  } as unknown as ContentHighlighter;
}

function createMockElement(): HTMLElement {
  return {} as HTMLElement;
}

function createMockCorrection(): ProofreadCorrection {
  return {
    startIndex: 0,
    endIndex: 5,
    correction: 'fixed',
  };
}

describe('PopoverManager', () => {
  let manager: PopoverManager;
  let highlighter: ContentHighlighter;
  let onCorrectionApplied: (element: HTMLElement, correction: ProofreadCorrection) => void;
  let onPopoverHide: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    highlighter = createMockHighlighter();
    onCorrectionApplied = vi.fn() as any;
    onPopoverHide = vi.fn() as any;

    manager = new PopoverManager({
      highlighter,
      onCorrectionApplied,
      onPopoverHide,
    });
  });

  describe('show', () => {
    it('should create and show popover', () => {
      const element = createMockElement();
      const correction = createMockCorrection();

      manager.show(element, correction, 'error', 100, 200);

      const popover = (manager as any).popover;
      expect(popover).toBeTruthy();
      expect(popover.show).toHaveBeenCalledWith({
        element,
        correction,
        issueText: 'error',
        x: 100,
        y: 200,
        positionResolver: undefined,
      });
    });

    it('should reuse existing popover', () => {
      const element = createMockElement();
      const correction = createMockCorrection();

      manager.show(element, correction, 'error', 100, 200);
      const firstPopover = (manager as any).popover;

      manager.show(element, correction, 'another', 150, 250);
      const secondPopover = (manager as any).popover;

      expect(firstPopover).toBe(secondPopover);
    });

    it('should use position resolver when provided', () => {
      const element = createMockElement();
      const correction = createMockCorrection();
      const positionResolver = vi.fn(() => ({ x: 300, y: 400 }));

      manager.show(element, correction, 'error', 100, 200, positionResolver);

      const popover = (manager as any).popover;
      expect(popover.show).toHaveBeenCalledWith({
        element,
        correction,
        issueText: 'error',
        x: 100,
        y: 200,
        positionResolver,
      });
    });
  });

  describe('hide', () => {
    it('should hide popover if it exists', () => {
      const element = createMockElement();
      const correction = createMockCorrection();

      manager.show(element, correction, 'error', 100, 200);
      manager.hide();

      const popover = (manager as any).popover;
      expect(popover.hide).toHaveBeenCalled();
    });

    it('should not throw if popover does not exist', () => {
      expect(() => manager.hide()).not.toThrow();
    });
  });

  describe('setAutofixOnDoubleClick', () => {
    it('should store autofix setting', () => {
      manager.setAutofixOnDoubleClick(true);
      expect((manager as any).autofixOnDoubleClick).toBe(true);

      manager.setAutofixOnDoubleClick(false);
      expect((manager as any).autofixOnDoubleClick).toBe(false);
    });
  });

  describe('updateVisibility', () => {
    it('should detach popover when autofix is enabled', () => {
      const element = createMockElement();
      const correction = createMockCorrection();

      manager.show(element, correction, 'error', 100, 200);
      manager.setAutofixOnDoubleClick(true);
      manager.updateVisibility(true);

      expect((manager as any).popover).toBeNull();
    });

    it('should detach popover when no corrections exist', () => {
      const element = createMockElement();
      const correction = createMockCorrection();

      manager.show(element, correction, 'error', 100, 200);
      manager.updateVisibility(false);

      expect((manager as any).popover).toBeNull();
    });

    it('should ensure popover when autofix is disabled and corrections exist', () => {
      manager.setAutofixOnDoubleClick(false);
      manager.updateVisibility(true);

      expect((manager as any).popover).toBeTruthy();
    });
  });

  describe('destroy', () => {
    it('should remove popover and cleanup', () => {
      const element = createMockElement();
      const correction = createMockCorrection();

      manager.show(element, correction, 'error', 100, 200);
      const popover = (manager as any).popover;

      manager.destroy();

      expect(popover.remove).toHaveBeenCalled();
      expect((manager as any).popover).toBeNull();
      expect(highlighter.setPopover).toHaveBeenCalledWith(null);
    });

    it('should not throw if popover does not exist', () => {
      expect(() => manager.destroy()).not.toThrow();
    });
  });
});
