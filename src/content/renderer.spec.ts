import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CorrectionColorThemeMap } from '../shared/utils/correction-types.ts';
import { UnderlineRenderer, type UnderlineDescriptor } from './renderer.ts';

class MockStyle {
  [key: string]: string | ((name: string, value: string) => void);
  setProperty(name: string, value: string) {
    (this as Record<string, string>)[name] = value;
  }
}

class MockDiv {
  children: MockDiv[] = [];
  style: MockStyle = new MockStyle() as MockStyle;
  dataset: Record<string, string> = {};
  constructor(public className = '') {}
  appendChild(node: MockDiv) {
    this.children.push(node);
    node.parent = this;
    return node;
  }
  removeChild(node: MockDiv) {
    this.children = this.children.filter((child) => child !== node);
    node.parent = undefined;
  }
  remove() {
    this.parent?.removeChild(this);
  }
  parent?: MockDiv;
}

describe('UnderlineRenderer', () => {
  let container: MockDiv;
  const palette: CorrectionColorThemeMap = {
    spelling: {
      color: '#111',
      background: '#eee',
      border: '#ccc',
      label: 'Spelling',
    },
  } as CorrectionColorThemeMap;

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
    container = new MockDiv();
    vi.stubGlobal('document', {
      createElement: () => new MockDiv(),
    } as unknown as Document);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function descriptor(key: string, rect: DOMRect): UnderlineDescriptor {
    return {
      key,
      issueId: key,
      type: 'spelling',
      rectIndex: 0,
      rect,
    };
  }

  it('renders descriptors inside viewport and skips those outside margin', () => {
    const renderer = new UnderlineRenderer(container as unknown as HTMLElement);
    const descriptors = [
      descriptor('visible', new DOMRect(10, 10, 50, 5)),
      descriptor('offscreen', new DOMRect(1000, 10, 50, 5)),
    ];

    renderer.render(descriptors, {
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 200,
      clientHeight: 200,
      lineHeight: 16,
      margin: 50,
      palette,
      underlineStyle: 'solid',
    });

    expect(container.children).toHaveLength(1);
    expect(container.children[0].style.left).toBe('10px');
  });

  it('marks active issues and removes stale underline elements', () => {
    const renderer = new UnderlineRenderer(container as unknown as HTMLElement);
    const first = descriptor('issue-1', new DOMRect(0, 0, 40, 5));
    const second = descriptor('issue-2', new DOMRect(0, 20, 40, 5));

    renderer.render([first, second], {
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 200,
      clientHeight: 200,
      lineHeight: 16,
      margin: 10,
      activeIssueId: 'issue-2',
      palette,
      underlineStyle: 'wavy',
    });

    expect(container.children).toHaveLength(2);
    expect(container.children[1].dataset.active).toBe('true');

    renderer.render([second], {
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 200,
      clientHeight: 200,
      lineHeight: 16,
      margin: 10,
      activeIssueId: null,
      palette,
      underlineStyle: 'dotted',
    });

    expect(container.children).toHaveLength(1);
    expect(container.children[0].dataset.underlineStyle).toBe('dotted');
    expect(container.children[0].dataset.active).toBeUndefined();
  });

  it('clears all underline nodes when requested', () => {
    const renderer = new UnderlineRenderer(container as unknown as HTMLElement);
    renderer.render([descriptor('one', new DOMRect(0, 0, 10, 5))], {
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 200,
      clientHeight: 200,
      lineHeight: 16,
      margin: 10,
      palette,
      underlineStyle: 'solid',
    });

    renderer.clear();

    expect(container.children).toHaveLength(0);
  });
});
