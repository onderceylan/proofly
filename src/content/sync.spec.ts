import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRafScheduler } from './sync.ts';

type FrameCallback = (time: number) => void;

describe('createRafScheduler', () => {
  const frames = new Map<number, FrameCallback>();
  let nextId = 1;
  const rafMock = vi.fn<(cb: FrameCallback) => number>();
  const cafMock = vi.fn<(id: number) => void>();

  beforeEach(() => {
    nextId = 1;
    frames.clear();
    rafMock.mockImplementation((cb: FrameCallback) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    });
    cafMock.mockImplementation((id: number) => {
      frames.delete(id);
    });
    vi.stubGlobal('requestAnimationFrame', rafMock);
    vi.stubGlobal('cancelAnimationFrame', cafMock);
  });

  afterEach(() => {
    frames.clear();
    vi.unstubAllGlobals();
  });

  it('invokes callback once per frame even if schedule called multiple times', () => {
    const callback = vi.fn();
    const scheduler = createRafScheduler(callback);

    scheduler.schedule();
    scheduler.schedule();

    expect(rafMock).toHaveBeenCalledTimes(1);

    const [frameId, frame] = Array.from(frames.entries())[0]!;
    frames.delete(frameId);
    frame?.(16);

    expect(callback).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    expect(rafMock).toHaveBeenCalledTimes(2);
  });

  it('cancels pending frame and prevents callback execution', () => {
    const callback = vi.fn();
    const scheduler = createRafScheduler(callback);

    scheduler.schedule();
    const [frameId] = frames.keys();
    scheduler.cancel();

    expect(frames.has(frameId!)).toBe(false);

    // Even if frame fires manually, callback should not run because it was removed.
    frames.get(frameId!)?.(16);
    expect(callback).not.toHaveBeenCalled();
  });
});
