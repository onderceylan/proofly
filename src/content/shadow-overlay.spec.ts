import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShadowOverlay } from './shadow-overlay.ts';

const { getBoxMetricsMock } = vi.hoisted(() => ({
  getBoxMetricsMock: vi.fn(),
}));

vi.mock('./utils.ts', () => ({
  getBoxMetrics: getBoxMetricsMock,
}));

class MockElement {
  id = '';
  style: Record<string, string> = {};
  children: MockElement[] = [];
  parent: MockElement | MockBody | null = null;
  shadowRoot: { children: unknown[]; append: (...nodes: unknown[]) => void } | null = null;
  textContent = '';
  dataset: Record<string, string> = {};
  private rect: DOMRect = new DOMRect(0, 0, 0, 0);

  constructor(public tagName: string) {}

  setBoundingClientRect(rect: DOMRect) {
    this.rect = rect;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  append(...nodes: MockElement[]) {
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  appendChild(node: MockElement) {
    node.parent = this;
    this.children.push(node);
    return node;
  }

  insertBefore(node: MockElement, reference: MockElement) {
    node.parent = this;
    const index = this.children.indexOf(reference);
    if (index === -1) {
      this.children.push(node);
    } else {
      this.children.splice(index, 0, node);
    }
  }

  attachShadow() {
    const shadow = {
      children: [] as unknown[],
      append: (...nodes: unknown[]) => {
        shadow.children.push(...nodes);
      },
    };
    this.shadowRoot = shadow;
    return shadow;
  }

  remove() {
    if (this.parent && 'removeChild' in this.parent) {
      this.parent.removeChild(this);
    }
    this.parent = null;
  }
}

class MockBody {
  children: MockElement[] = [];
  appendChild(node: MockElement) {
    node.parent = this;
    this.children.push(node);
    return node;
  }
  removeChild(node: MockElement) {
    this.children = this.children.filter((child) => child !== node);
    node.parent = null;
  }
}

describe('ShadowOverlay', () => {
  const body = new MockBody();
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
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag === 'style') {
          return { textContent: '' };
        }
        if (tag === 'div') {
          const el = new MockElement('div');
          if (!el.id) {
            el.id = '';
          }
          return el;
        }
        return new MockElement(tag);
      },
      body,
    } as unknown as Document);

    vi.stubGlobal('window', {
      scrollX: 5,
      scrollY: 10,
    });

    vi.stubGlobal('getComputedStyle', () => ({
      zIndex: '3',
    }));

    getBoxMetricsMock.mockReturnValue({
      rect: new DOMRect(100, 200, 300, 150),
      border: { top: 2, left: 3, right: 2, bottom: 2 },
      padding: { top: 0, left: 0, right: 0, bottom: 0 },
    });
  });

  afterEach(() => {
    body.children = [];
    getBoxMetricsMock.mockReset();
    vi.unstubAllGlobals();
  });

  function createTarget(): HTMLTextAreaElement {
    const target = {
      clientWidth: 200,
      clientHeight: 100,
      getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
    } as unknown as HTMLTextAreaElement;
    return target;
  }

  it('attaches host element and updates layout', () => {
    const overlay = new ShadowOverlay(createTarget());
    overlay.attach();

    expect(body.children).toHaveLength(1);
    const host = body.children[0];
    expect(host.style.top).toBe(`${200 + 10}px`);
    expect(host.style.left).toBe(`${100 + 5}px`);
    expect(host.style.zIndex).toBe('4');
  });

  it('updates container and underline sizes from box metrics', () => {
    const overlay = new ShadowOverlay(createTarget());
    overlay.attach();

    overlay.updateLayout();

    expect(overlay.elements.container.style.width).toBe('200px');
    expect(overlay.elements.container.style.top).toBe('2px');
    expect(overlay.elements.underlines.style.width).toBe('200px');
  });

  it('updates scroll transform for underline layer', () => {
    const overlay = new ShadowOverlay(createTarget());
    overlay.attach();

    overlay.updateScroll(20, 30);

    expect(overlay.elements.underlines.style.transform).toBe('translate(-20px, -30px)');
  });

  it('detaches host from document body', () => {
    const overlay = new ShadowOverlay(createTarget());
    overlay.attach();
    overlay.detach();

    expect(body.children).toHaveLength(0);
  });
});
