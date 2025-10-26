import { getBoxMetrics } from './utils.ts';

export interface OverlayElements {
  host: HTMLElement;
  shadow: ShadowRoot;
  container: HTMLDivElement;
  underlines: HTMLDivElement;
}

export class ShadowOverlay {
  readonly elements: OverlayElements;
  private mounted = false;

  constructor(private readonly target: HTMLTextAreaElement | HTMLInputElement) {
    const host = document.createElement('proofly-highlighter');
    host.style.position = 'absolute';
    host.style.pointerEvents = 'none';
    host.style.overflow = 'hidden';
    host.style.zIndex = computeZIndex(target);
    host.style.inset = '0px';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    const waveMask = `url("data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 4" preserveAspectRatio="none">' +
        '<path d="M0 2 Q3 0 6 2 T12 2" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />' +
      '</svg>'
    )}")`;
    style.textContent = `
      :host {
        all: initial;
        contain: layout paint style;
      }
      #container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        pointer-events: none;
        contain: layout paint;
      }
      #underlines {
        position: absolute;
        top: 0;
        left: 0;
        pointer-events: none;
        transform: translate3d(0, 0, 0);
        will-change: transform;
      }
      .u {
        position: absolute;
        pointer-events: auto;
        border-radius: 4px;
        color: rgba(220, 38, 38, 0.9);
        --fill-color: rgba(220, 38, 38, 0.16);
      }
      .u::before,
      .u::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
      }
      .u::before {
        top: 0;
        bottom: 0;
        opacity: 0;
        transition: opacity 120ms ease;
        background-color: var(--fill-color);
      }
      .u::after {
        height: var(--underline-height, 3px);
        bottom: var(--underline-offset, 2px);
        border-radius: 999px;
        background-color: currentColor;
      }
      .u[data-active="true"]::before {
        opacity: 1;
      }
      .u[data-underline-style="solid"]::after {
        -webkit-mask-image: none;
        mask-image: none;
      }
      .u[data-underline-style="dotted"]::after {
         background-image: linear-gradient(to right, currentColor 50%, transparent 50%);
         background-size: 4px 2px;
         background-repeat: repeat-x;
         background-color: transparent;
      }
      .u[data-underline-style="wavy"]::after {
        mask-image: ${waveMask};
        mask-size: 12px 6px;
        mask-repeat: repeat-x;
        mask-position: left calc(100% + 1px);
      }
    `;

    const container = document.createElement('div');
    container.id = 'container';

    const underlines = document.createElement('div');
    underlines.id = 'underlines';

    container.append(underlines);
    shadow.append(style, container);

    this.elements = { host, shadow, container, underlines };
  }

  attach(): void {
    if (this.mounted) {
      return;
    }
    document.body.appendChild(this.elements.host);
    this.mounted = true;
    this.updateLayout();
  }

  detach(): void {
    if (!this.mounted) {
      return;
    }
    this.elements.host.remove();
    this.mounted = false;
  }

  updateLayout(): void {
    const metrics = getBoxMetrics(this.target);
    const { host, container } = this.elements;
    const { scrollX, scrollY } = window;
    host.style.width = `${metrics.rect.width}px`;
    host.style.height = `${metrics.rect.height}px`;
    host.style.top = `${metrics.rect.top + scrollY}px`;
    host.style.left = `${metrics.rect.left + scrollX}px`;

    container.style.top = `${metrics.border.top}px`;
    container.style.left = `${metrics.border.left}px`;
    container.style.width = `${this.target.clientWidth}px`;
    container.style.height = `${this.target.clientHeight}px`;
    this.elements.underlines.style.width = container.style.width;
    this.elements.underlines.style.height = container.style.height;
  }

  updateScroll(scrollLeft: number, scrollTop: number): void {
    this.elements.underlines.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
  }

  getContainerClientRect(): DOMRect {
    return this.elements.container.getBoundingClientRect();
  }
}

function computeZIndex(target: HTMLElement): string {
  const value = Number.parseInt(getComputedStyle(target).zIndex ?? '', 10);
  if (Number.isFinite(value)) {
    return String(value + 1);
  }
  return '1';
}
