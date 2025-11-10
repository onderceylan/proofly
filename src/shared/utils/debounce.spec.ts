import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce.ts';

describe('debounce utility', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays execution until timeout elapses', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 200);

    debounced('first');
    debounced('second');
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('second');
  });

  it('cancels pending invocation', () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);
    expect(spy).not.toHaveBeenCalled();
  });
});
