import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const originalWindow = globalThis.window;
const originalChrome = globalThis.chrome;
const originalBroadcast = globalThis.BroadcastChannel;
const originalCustomEvent = globalThis.CustomEvent;
const globalAny = globalThis as any;
let emitProofreadControlEvent: typeof import('./control-events.ts').emitProofreadControlEvent;
let PROOFREAD_CONTROL_EVENT: typeof import('./control-events.ts').PROOFREAD_CONTROL_EVENT;

describe('proofread control events', () => {
  const dispatchEvent = vi.fn();
  const postMessage = vi.fn();
  const sendMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    class MockCustomEvent {
      detail: unknown;
      type: string;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    }
    globalAny.CustomEvent = MockCustomEvent;

    globalAny.window = {
      dispatchEvent,
    } as unknown as Window;

    class MockBroadcastChannel {
      name: string;
      constructor(name: string) {
        this.name = name;
      }
      postMessage = postMessage;
    }
    globalAny.BroadcastChannel = MockBroadcastChannel;

    globalAny.chrome = {
      runtime: {
        sendMessage,
      },
    } as unknown as typeof chrome;

    const module = await import('./control-events.ts');
    emitProofreadControlEvent = module.emitProofreadControlEvent;
    PROOFREAD_CONTROL_EVENT = module.PROOFREAD_CONTROL_EVENT;
  });

  it('dispatches DOM, broadcast, and runtime events', () => {
    const detail = {
      status: 'queued',
      executionId: 'exec',
      elementId: 'el',
      elementKind: 'input',
      textLength: 5,
      timestamp: Date.now(),
    } as const;

    emitProofreadControlEvent(detail);

    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: PROOFREAD_CONTROL_EVENT, detail })
    );
    expect(postMessage).toHaveBeenCalledWith(detail);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'proofly:proofread-control',
      payload: detail,
    });
  });

  it('guards when runtime messaging is unavailable', () => {
    delete (globalThis as any).chrome;
    expect(() =>
      emitProofreadControlEvent({
        status: 'ignored',
        executionId: 'id',
        elementId: 'e',
        elementKind: 'input',
        textLength: 0,
        timestamp: Date.now(),
      })
    ).not.toThrow();
  });
});

afterAll(() => {
  globalAny.window = originalWindow;
  globalAny.chrome = originalChrome;
  globalAny.BroadcastChannel = originalBroadcast;
  globalAny.CustomEvent = originalCustomEvent;
});
