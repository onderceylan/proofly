import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContentEditableTargetHandler } from './contenteditable-target-handler.ts';
import type { IssueColorPalette } from '../target-session.ts';

vi.mock('../sync.ts', () => ({
  createRafScheduler: vi.fn(() => ({ schedule: vi.fn(), cancel: vi.fn() })),
}));

vi.mock('../renderer.ts', () => ({
  UnderlineRenderer: class {
    clear = vi.fn();
    render = vi.fn();
  },
}));

vi.mock('../../shared/utils/contenteditable-text.ts', () => ({
  extractContentEditableText: vi.fn(() => 'test text'),
  resolveContentEditableOffset: vi.fn(),
}));

vi.mock('../../shared/utils/correction-types.ts', () => ({
  getCorrectionTypeColor: vi.fn(() => ({ label: 'Spelling', color: '#dc2626' })),
}));

function createFakeDomElement() {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    addEventListener: vi.fn((type: string, fn: (...args: unknown[]) => void) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: (...args: unknown[]) => void) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    }),
    fire(type: string) {
      (listeners[type] || []).forEach((fn) => fn());
    },
    getBoundingClientRect: vi.fn(() => new DOMRect(0, 0, 200, 100)),
    parentElement: { insertBefore: vi.fn(), appendChild: vi.fn() },
    nextSibling: null,
    closest: vi.fn(() => null),
    ownerDocument: { body: { appendChild: vi.fn() } },
    clientWidth: 200,
    clientHeight: 100,
    isContentEditable: true,
    childNodes: [],
    textContent: 'test text',
  };
}

function createStubElement() {
  return {
    setAttribute: vi.fn(),
    style: {} as Record<string, string>,
    attachShadow: vi.fn(() => ({ append: vi.fn() })),
    remove: vi.fn(),
    id: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    classList: { contains: vi.fn(() => false) },
    dataset: {} as Record<string, string>,
    appendChild: vi.fn(),
  };
}

describe('ContentEditableTargetHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', {
      createElement: vi.fn(() => createStubElement()),
      createRange: vi.fn(() => ({
        setStart: vi.fn(),
        setEnd: vi.fn(),
        getClientRects: vi.fn(() => []),
      })),
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({
        zIndex: '1',
        overflow: 'visible',
        overflowY: 'visible',
        lineHeight: '20',
        fontSize: '16',
      }))
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      }
    );
    vi.stubGlobal(
      'DOMRect',
      class DOMRect {
        constructor(
          public x = 0,
          public y = 0,
          public width = 0,
          public height = 0
        ) {}
        get left() {
          return this.x;
        }
        get top() {
          return this.y;
        }
        get right() {
          return this.x + this.width;
        }
        get bottom() {
          return this.y + this.height;
        }
      }
    );
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('input handling', () => {
    it('should call onInvalidateIssues immediately on input', () => {
      const element = createFakeDomElement();
      const onInvalidateIssues = vi.fn();
      const handler = new ContentEditableTargetHandler(element as unknown as HTMLElement, {
        onUnderlineClick: vi.fn(),
        onUnderlineDoubleClick: vi.fn(),
        onInvalidateIssues,
        onNeedProofread: vi.fn(),
        initialPalette: {} as IssueColorPalette,
        initialUnderlineStyle: 'wavy',
        initialAutofixOnDoubleClick: false,
      });

      handler.attach();
      element.fire('input');

      expect(onInvalidateIssues).toHaveBeenCalledTimes(1);
    });

    it('should call onNeedProofread after debounce on input', () => {
      const element = createFakeDomElement();
      const onNeedProofread = vi.fn();
      const handler = new ContentEditableTargetHandler(element as unknown as HTMLElement, {
        onUnderlineClick: vi.fn(),
        onUnderlineDoubleClick: vi.fn(),
        onInvalidateIssues: vi.fn(),
        onNeedProofread,
        initialPalette: {} as IssueColorPalette,
        initialUnderlineStyle: 'wavy',
        initialAutofixOnDoubleClick: false,
      });

      handler.attach();
      element.fire('input');

      expect(onNeedProofread).not.toHaveBeenCalled();

      vi.advanceTimersByTime(800);

      expect(onNeedProofread).toHaveBeenCalledTimes(1);
    });

    it('should debounce multiple rapid inputs into single onNeedProofread call', () => {
      const element = createFakeDomElement();
      const onInvalidateIssues = vi.fn();
      const onNeedProofread = vi.fn();
      const handler = new ContentEditableTargetHandler(element as unknown as HTMLElement, {
        onUnderlineClick: vi.fn(),
        onUnderlineDoubleClick: vi.fn(),
        onInvalidateIssues,
        onNeedProofread,
        initialPalette: {} as IssueColorPalette,
        initialUnderlineStyle: 'wavy',
        initialAutofixOnDoubleClick: false,
      });

      handler.attach();

      element.fire('input');
      vi.advanceTimersByTime(300);
      element.fire('input');
      vi.advanceTimersByTime(300);
      element.fire('input');

      expect(onInvalidateIssues).toHaveBeenCalledTimes(3);
      expect(onNeedProofread).not.toHaveBeenCalled();

      vi.advanceTimersByTime(800);

      expect(onNeedProofread).toHaveBeenCalledTimes(1);
    });

    it('should not call onNeedProofread when callback is not provided', () => {
      const element = createFakeDomElement();
      const onInvalidateIssues = vi.fn();
      const handler = new ContentEditableTargetHandler(element as unknown as HTMLElement, {
        onUnderlineClick: vi.fn(),
        onUnderlineDoubleClick: vi.fn(),
        onInvalidateIssues,
        initialPalette: {} as IssueColorPalette,
        initialUnderlineStyle: 'wavy',
        initialAutofixOnDoubleClick: false,
      });

      handler.attach();
      element.fire('input');

      vi.advanceTimersByTime(800);

      expect(onInvalidateIssues).toHaveBeenCalledTimes(1);
    });
  });
});
