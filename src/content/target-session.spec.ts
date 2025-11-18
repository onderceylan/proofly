import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TargetSession, type Issue } from './target-session.ts';

const {
  shadowOverlayCtor,
  createMirrorMock,
  UnderlineRendererMock,
  createRafSchedulerMock,
  debounceMock,
  computeLineHeightMock,
  getBoxMetricsMock,
  buildPaletteMock,
} = vi.hoisted(() => ({
  shadowOverlayCtor: vi.fn(),
  createMirrorMock: vi.fn(),
  UnderlineRendererMock: vi.fn(),
  createRafSchedulerMock: vi.fn(),
  debounceMock: vi.fn(),
  computeLineHeightMock: vi.fn(),
  getBoxMetricsMock: vi.fn(),
  buildPaletteMock: vi.fn(),
}));

vi.mock('./shadow-overlay.ts', () => ({
  ShadowOverlay: shadowOverlayCtor,
}));

vi.mock('./mirror.ts', () => ({
  createMirror: createMirrorMock,
}));

vi.mock('./renderer.ts', () => ({
  UnderlineRenderer: UnderlineRendererMock,
}));

vi.mock('./sync.ts', () => ({
  createRafScheduler: createRafSchedulerMock,
}));

vi.mock('./utils.ts', () => ({
  debounce: debounceMock,
  computeLineHeight: computeLineHeightMock,
  getBoxMetrics: getBoxMetricsMock,
}));

vi.mock('../shared/utils/correction-types.ts', () => ({
  buildCorrectionColorThemes: buildPaletteMock,
}));

function createListenerTarget() {
  const listeners = new Map<string, EventListener>();
  return {
    addEventListener: vi.fn((event: string, handler: EventListener) => {
      listeners.set(event, handler);
    }),
    removeEventListener: vi.fn((event: string) => {
      listeners.delete(event);
    }),
    getListener: (event: string) => listeners.get(event),
  };
}

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}

class MockMutationObserver {
  constructor(public callback: MutationCallback) {}
  observe = vi.fn();
  disconnect = vi.fn();
}

describe('TargetSession', () => {
  let target: HTMLTextAreaElement & {
    getListener: (event: string) => EventListener | undefined;
  };
  let hooks: NonNullable<ConstructorParameters<typeof TargetSession>[1]>;
  let overlayInstance: any;
  let mirrorInstance: any;
  let rendererInstance: any;
  let rafInstance: any;
  let underlineListeners: Map<string, EventListener>;

  beforeEach(() => {
    class MockRect {
      left: number;
      top: number;
      width: number;
      height: number;
      constructor(left = 0, top = 0, width = 0, height = 0) {
        this.left = left;
        this.top = top;
        this.width = width;
        this.height = height;
      }
    }
    vi.stubGlobal('DOMRect', MockRect as unknown as typeof DOMRect);
    vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as ResizeObserver);
    vi.stubGlobal('MutationObserver', MockMutationObserver as unknown as MutationObserver);

    const windowListeners = new Map<string, EventListener>();
    vi.stubGlobal('window', {
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        windowListeners.set(event, handler);
      }),
      removeEventListener: vi.fn((event: string) => {
        windowListeners.delete(event);
      }),
      scrollX: 0,
      scrollY: 0,
    });

    hooks = {
      onNeedProofread: vi.fn(),
      onUnderlineClick: vi.fn(),
      onUnderlineDoubleClick: vi.fn(),
      onInvalidateIssues: vi.fn(),
    };

    underlineListeners = new Map();
    overlayInstance = {
      attach: vi.fn(),
      detach: vi.fn(),
      updateLayout: vi.fn(),
      updateScroll: vi.fn(),
      getContainerClientRect: vi.fn(() => new DOMRect(0, 0, 200, 100)),
      elements: {
        host: {},
        container: {
          insertBefore: vi.fn(),
        },
        underlines: {
          addEventListener: vi.fn((event: string, handler: EventListener) =>
            underlineListeners.set(event, handler)
          ),
          removeEventListener: vi.fn((event: string) => underlineListeners.delete(event)),
          style: {},
        },
      },
    };
    shadowOverlayCtor.mockImplementation(function () {
      return overlayInstance;
    });

    mirrorInstance = {
      element: { id: 'mirror' },
      textNode: { length: 10 },
      isTextarea: true,
      setValue: vi.fn(),
      updateStylesFrom: vi.fn(),
      setWidth: vi.fn(),
      getRects: vi.fn(() => [new DOMRect(10, 20, 40, 10)]),
      getCaretRect: vi.fn(),
      getTextLength: vi.fn(() => 10),
    };
    createMirrorMock.mockReturnValue(mirrorInstance);

    rendererInstance = {
      render: vi.fn(),
      clear: vi.fn(),
    };
    UnderlineRendererMock.mockImplementation(function () {
      return rendererInstance;
    });

    rafInstance = {
      schedule: vi.fn(),
      cancel: vi.fn(),
    };
    createRafSchedulerMock.mockReturnValue(rafInstance);

    debounceMock.mockImplementation((fn: any) => fn);
    computeLineHeightMock.mockReturnValue(18);
    getBoxMetricsMock.mockReturnValue({
      padding: { top: 1, right: 2, bottom: 3, left: 4 },
      border: { top: 0, right: 0, bottom: 0, left: 0 },
      rect: new DOMRect(0, 0, 200, 100),
    });
    buildPaletteMock.mockReturnValue({
      spelling: {
        color: '#f00',
        background: '#fee',
        border: '#fcc',
        label: 'Spelling',
      },
    });

    const listenerTarget = createListenerTarget();
    const element = {
      value: 'Sample text',
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 200,
      clientHeight: 100,
      scrollWidth: 200,
      scrollHeight: 100,
      addEventListener: listenerTarget.addEventListener,
      removeEventListener: listenerTarget.removeEventListener,
      getListener: listenerTarget.getListener,
      scrollBy: vi.fn(({ left = 0, top = 0 }: { left?: number; top?: number } = {}) => {
        element.scrollLeft += left ?? 0;
        element.scrollTop += top ?? 0;
      }),
    };
    target = element as unknown as HTMLTextAreaElement & {
      getListener: (event: string) => EventListener | undefined;
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function createSession() {
    return new TargetSession(target, hooks);
  }

  function triggerUnderline(eventName: string, detail: Partial<MouseEvent> & { target?: any }) {
    const handler = underlineListeners.get(eventName);
    if (handler) {
      const defaultPrevented = { prevented: false };
      handler({
        preventDefault: () => {
          defaultPrevented.prevented = true;
        },
        ...detail,
      } as unknown as MouseEvent);
      return defaultPrevented.prevented;
    }
    return false;
  }

  it('attaches overlay once issues are present and schedules initial frame', () => {
    const session = createSession();
    session.attach();
    session.setIssues([
      { id: 'attach-1', start: 0, end: 3, type: 'spelling', label: 'Attachment label' },
    ]);

    expect(overlayInstance.attach).toHaveBeenCalled();
    expect(target.addEventListener).toHaveBeenCalledWith('input', expect.any(Function));
    expect(rafInstance.schedule).toHaveBeenCalled();
  });

  it('handles input events by invalidating issues and requesting proofread', () => {
    const session = createSession();
    session.attach();

    const inputHandler = target.getListener('input');
    expect(inputHandler).toBeDefined();
    target.value = 'Updated text';
    inputHandler?.(new Event('input'));

    expect(hooks.onInvalidateIssues).toHaveBeenCalled();
    expect(hooks.onNeedProofread).toHaveBeenCalledWith('Updated text');
  });

  it('renders issues via renderer after measurement flush', () => {
    const session = createSession();
    session.attach();
    const issues: Issue[] = [
      { id: 'iss-1', start: 0, end: 5, type: 'spelling', label: 'Spelling suggestion' },
    ];
    session.setIssues(issues);

    (session as any).flushFrame();

    expect(rendererInstance.render).toHaveBeenCalled();
    const [, options] = rendererInstance.render.mock.calls[0];
    expect(options.activeIssueId).toBeNull();
  });

  it('invokes underline click hooks with computed rect', () => {
    const session = createSession();
    session.attach();
    session.setIssues([
      { id: 'iss-1', start: 0, end: 5, type: 'spelling', label: 'Spelling suggestion' },
    ]);

    triggerUnderline('click', {
      target: {
        classList: { contains: (value: string) => value === 'u' },
        dataset: { issueId: 'iss-1' },
        getBoundingClientRect: () => new DOMRect(5, 6, 10, 4),
      },
    } as Partial<MouseEvent> & { target: any });

    expect(hooks.onUnderlineClick).toHaveBeenCalledWith(
      'iss-1',
      expect.any(DOMRect),
      expect.objectContaining({ dataset: { issueId: 'iss-1' } })
    );
  });

  it('activates underline issues via keyboard events', () => {
    const session = createSession();
    session.attach();
    session.setIssues([
      { id: 'kbd-1', start: 0, end: 4, type: 'spelling', label: 'Keyboard suggestion' },
    ]);

    const keydownHandler = underlineListeners.get('keydown');
    expect(keydownHandler).toBeDefined();

    keydownHandler?.({
      key: 'Enter',
      preventDefault: vi.fn(),
      target: {
        classList: { contains: (value: string) => value === 'u' },
        dataset: { issueId: 'kbd-1' },
        getBoundingClientRect: () => new DOMRect(5, 6, 10, 4),
      },
    } as unknown as KeyboardEvent);

    expect(hooks.onUnderlineClick).toHaveBeenCalledWith(
      'kbd-1',
      expect.any(DOMRect),
      expect.objectContaining({ dataset: { issueId: 'kbd-1' } })
    );
  });

  it('handles double click autofix when enabled', () => {
    const session = createSession();
    session.attach();
    const issues: Issue[] = [
      { id: 'fix-1', start: 0, end: 4, type: 'spelling', label: 'Spelling suggestion' },
    ];
    session.setIssues(issues);
    session.setAutofixOnDoubleClick(true);

    triggerUnderline('dblclick', {
      target: {
        classList: { contains: (value: string) => value === 'u' },
        dataset: { issueId: 'fix-1' },
      },
    } as Partial<MouseEvent> & { target: any });

    expect(hooks.onUnderlineDoubleClick).toHaveBeenCalledWith('fix-1', issues[0]);
    expect(hooks.onUnderlineClick).not.toHaveBeenCalled();
  });

  it('detaches overlay and cleans up listeners', () => {
    const session = createSession();
    session.attach();
    session.setIssues([
      { id: 'detach-1', start: 0, end: 3, type: 'spelling', label: 'Detach label' },
    ]);
    session.detach();

    expect(rafInstance.cancel).toHaveBeenCalled();
    expect(rendererInstance.clear).toHaveBeenCalled();
    expect(overlayInstance.detach).toHaveBeenCalled();
  });
});
