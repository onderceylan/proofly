import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMirror } from './mirror.ts';

const { cloneTextStyles, valueToMirrorNodes } = vi.hoisted(() => ({
  cloneTextStyles: vi.fn(),
  valueToMirrorNodes: vi.fn(),
}));

vi.mock('./utils.ts', () => ({
  cloneTextStyles,
  valueToMirrorNodes,
}));

class MockText {
  constructor(public data: string) {}
  get length(): number {
    return this.data.length;
  }
}

class MockRange {
  start = 0;
  end = 0;
  setStart(_node: MockText, offset: number) {
    this.start = offset;
  }
  setEnd(_node: MockText, offset: number) {
    this.end = offset;
  }
  getClientRects() {
    if (this.end <= this.start) {
      return [];
    }
    return [new DOMRect(this.start, 0, Math.max(1, this.end - this.start), 10)];
  }
  getBoundingClientRect() {
    return new DOMRect(this.end, 0, 1, 12);
  }
  detach() {}
}

class MockElement {
  id = '';
  style: Record<string, string> = {};
  textContent = '';
  children: unknown[] = [];
  append(node: unknown) {
    this.children.push(node);
  }
}

describe('createMirror', () => {
  const documentStub = {
    createElement: vi.fn((_tag: string) => new MockElement()),
    createRange: vi.fn(() => new MockRange()),
  } as unknown as Document;

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
    vi.stubGlobal('document', documentStub);
    valueToMirrorNodes.mockImplementation((value: string) => [new MockText(value)]);
  });

  afterEach(() => {
    cloneTextStyles.mockReset();
    valueToMirrorNodes.mockReset();
    vi.unstubAllGlobals();
  });

  function createTarget(tagName: string): HTMLTextAreaElement {
    return {
      tagName,
      value: 'initial',
    } as unknown as HTMLTextAreaElement;
  }

  it('initializes mirror with textarea-specific settings', () => {
    const mirror = createMirror(createTarget('textarea'));
    expect(mirror.isTextarea).toBe(true);
    expect(valueToMirrorNodes).toHaveBeenCalledWith('initial', true);
    expect(cloneTextStyles).toHaveBeenCalledTimes(1);
  });

  it('updates stored value and mirror width', () => {
    const mirror = createMirror(createTarget('input'));
    mirror.setValue('updated');
    expect(mirror.textNode.data).toBe('updated');

    mirror.setWidth(250);
    expect((mirror.element as any).style.width).toBe('250px');
  });

  it('gets rects and caret positions via DOM Range shims', () => {
    const mirror = createMirror(createTarget('input'));
    mirror.setValue('12345');
    const rects = mirror.getRects(1, 4);
    expect(rects).toHaveLength(1);
    expect(rects[0].width).toBe(3);

    const caret = mirror.getCaretRect(5);
    expect(caret?.left).toBe(5);
  });

  it('clamps ranges outside text length', () => {
    const mirror = createMirror(createTarget('input'));
    mirror.setValue('short');
    const rects = mirror.getRects(-10, 99);
    expect(rects).toHaveLength(1);
  });
});
