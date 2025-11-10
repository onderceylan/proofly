import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../services/logger.ts';
import {
  cloneTextStyles,
  computeLineHeight,
  debounce,
  getBoxMetrics,
  valueToMirrorNodes,
} from './utils.ts';

vi.mock('../services/logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

class MockTextNode {
  constructor(public data: string) {}
  get length(): number {
    return this.data.length;
  }
}

describe('content utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('document', {
      createTextNode: (text: string) => new MockTextNode(text),
    } as unknown as Document);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('computes box metrics with parsed borders, padding, and scrollbar sizes', () => {
    const target = {
      getBoundingClientRect: () => new DOMRect(10, 20, 100, 50),
      offsetWidth: 120,
      clientWidth: 100,
      offsetHeight: 90,
      clientHeight: 70,
    } as unknown as HTMLElement;

    vi.stubGlobal('getComputedStyle', () => ({
      borderTopWidth: '1',
      borderRightWidth: '2',
      borderBottomWidth: '3',
      borderLeftWidth: '4',
      paddingTop: '5',
      paddingRight: '6',
      paddingBottom: '7',
      paddingLeft: '8',
    }));

    const metrics = getBoxMetrics(target);

    expect(metrics.border).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });
    expect(metrics.padding).toEqual({ top: 5, right: 6, bottom: 7, left: 8 });
    expect(metrics.scrollBar.vertical).toBe(120 - 100 - 4 - 2);
    expect(metrics.rect.top).toBe(20);
  });

  it('clones critical text styles from source to destination', () => {
    const captured: Record<string, string> = {};
    const destination = {
      style: {
        setProperty: (name: string, value: string) => {
          captured[name] = value;
        },
      },
    } as unknown as HTMLElement;

    vi.stubGlobal('getComputedStyle', () => ({
      fontFamily: 'Inter',
      fontSize: '16px',
      fontWeight: '400',
      fontStyle: 'normal',
      fontVariant: 'none',
      letterSpacing: '0px',
      wordSpacing: '0px',
      lineHeight: '20px',
      textTransform: 'none',
      direction: 'ltr',
      tabSize: '4',
      whiteSpace: 'pre',
      textIndent: '0px',
      textAlign: 'left',
      paddingTop: '1px',
      paddingRight: '2px',
      paddingBottom: '3px',
      paddingLeft: '4px',
    }));

    cloneTextStyles({} as HTMLElement, destination);

    expect(captured['font-family']).toBe('Inter');
    expect(captured['padding-left']).toBe('4px');
  });

  it('normalizes textarea line endings when building mirror nodes', () => {
    const nodes = valueToMirrorNodes('hello\r\nworld', true);
    expect(nodes[0]?.data).toBe('hello\nworld');
  });

  it('normalizes input line endings when building mirror nodes', () => {
    const nodes = valueToMirrorNodes('one\r\ntwo\rthree', false);
    expect(nodes[0]?.data).toBe('one\ntwo\nthree');
  });

  it('debounces calls and only invokes callback with latest arguments', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debounced = debounce(callback, 100);

    debounced('first');
    debounced('second');
    vi.advanceTimersByTime(99);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('second');
    vi.useRealTimers();
  });

  it('computes numeric line-height directly when supplied', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      lineHeight: '24',
    }));
    const result = computeLineHeight({} as HTMLElement);
    expect(result).toBe(24);
  });

  it('falls back when line-height is normal', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      lineHeight: 'normal',
      fontSize: '20px',
    }));
    const result = computeLineHeight({} as HTMLElement, 1.5);
    expect(result).toBe(30);
  });

  it('logs warning and falls back when line-height cannot be parsed', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      lineHeight: 'calc(100%)',
      fontSize: '18px',
    }));
    const result = computeLineHeight({} as HTMLElement);
    expect(logger.warn).toHaveBeenCalledWith(
      { lineHeight: 'calc(100%)' },
      'Failed to parse line-height, using fallback'
    );
    expect(result).toBeCloseTo(21.6);
  });
});
