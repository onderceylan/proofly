import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProofreadCorrection } from '../../shared/types.ts';

function createButtonStub() {
  const listeners = new Map<string, (event: any) => void>();
  const element = {
    addEventListener: vi.fn((type: string, handler: (event: any) => void) => {
      listeners.set(type, handler);
    }),
  };
  return {
    element,
    dispatch: (type: string, event: any) => {
      listeners.get(type)?.(event);
    },
  };
}

function createEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation: vi.fn(),
  };
}

describe('CorrectionPopover', () => {
  let CorrectionPopover: typeof import('./correction-popover.ts').CorrectionPopover;
  let popover: InstanceType<typeof CorrectionPopover>;

  beforeEach(async () => {
    const docElement = {
      style: {
        setProperty: vi.fn(),
        removeProperty: vi.fn(),
      },
    };
    vi.resetModules();
    const createElement = vi.fn(() => ({
      style: {},
      className: '',
      appendChild: vi.fn(),
      innerHTML: '',
      textContent: '',
      setAttribute: vi.fn(),
      querySelector: vi.fn(() => null),
    }));
    vi.stubGlobal('document', {
      documentElement: docElement,
      createElement,
      body: {
        appendChild: vi.fn(),
      },
    });
    vi.stubGlobal(
      'HTMLElement',
      class {
        shadowRoot: any = null;
        setAttribute = vi.fn();
        removeAttribute = vi.fn();
        attachShadow() {
          this.shadowRoot = {
            appendChild: vi.fn(),
            append: vi.fn(),
          };
          return this.shadowRoot;
        }
      } as unknown as typeof globalThis.HTMLElement
    );
    vi.stubGlobal('customElements', {
      define: vi.fn(),
      get: vi.fn(() => undefined),
    });
    ({ CorrectionPopover } = await import('./correction-popover.ts'));
    popover = new CorrectionPopover();
    (popover as any).hide = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setupPopover(onApply = vi.fn()) {
    const applyButton = createButtonStub();
    const closeButton = createButtonStub();
    const correction: ProofreadCorrection = {
      startIndex: 0,
      endIndex: 5,
      correction: 'fixed',
    };
    const content = {
      innerHTML: '',
      querySelector: (selector: string) => {
        if (selector === '.apply-button') return applyButton.element;
        if (selector === '.close-button') return closeButton.element;
        return null;
      },
    } as unknown as HTMLDivElement;

    (popover as any).contentElement = content;
    popover.setCorrection(correction, 'issue text', onApply);

    return { applyButton, closeButton, onApply };
  }

  it('prevents pointerdown default on apply button', () => {
    const { applyButton } = setupPopover();
    const event = createEvent();

    applyButton.dispatch('pointerdown', event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('prevents click default and triggers handler on apply button', () => {
    const onApply = vi.fn();
    const { applyButton } = setupPopover(onApply);
    const clickEvent = createEvent();

    applyButton.dispatch('click', clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
