import { getCorrectionTypeColor } from '../../shared/utils/correction-types.ts';

export class CorrectionPopover extends HTMLElement {
  private contentElement: HTMLDivElement | null = null;
  private currentCorrection: ProofreadCorrection | null = null;
  private onApply: ((correction: ProofreadCorrection) => void) | null = null;
  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private isAnimating: boolean = false;
  private hideTimeoutId: number | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.setAttribute('popover', 'manual');
    this.render();
  }

  setCorrection(
    correction: ProofreadCorrection,
    onApply: (correction: ProofreadCorrection) => void
  ): void {
    this.currentCorrection = correction;
    this.onApply = onApply;
    this.updateContent();
  }

  show(x: number, y: number): void {
    // Cancel any pending hide animation
    if (this.hideTimeoutId !== null) {
      clearTimeout(this.hideTimeoutId);
      this.hideTimeoutId = null;
      this.isAnimating = false;
    }

    // Show popover first to get its dimensions
    this.showPopover();

    // Get popover dimensions
    const rect = this.getBoundingClientRect();
    const margin = 10; // Minimum margin from viewport edge

    // Adjust x to keep popover within viewport (horizontal bounds)
    const maxX = window.innerWidth - rect.width - margin;
    const minX = margin;
    if (x > maxX) {
      x = maxX;
    }
    if (x < minX) {
      x = minX;
    }

    // Adjust y to keep popover within viewport (vertical bounds)
    const maxY = window.innerHeight - rect.height - margin;
    const minY = margin;
    if (y > maxY) {
      y = maxY;
    }
    if (y < minY) {
      y = minY;
    }

    this.style.left = `${x}px`;
    this.style.top = `${y}px`;

    // Trigger flip in animation
    if (this.contentElement) {
      this.contentElement.classList.remove('flip-out');
      this.contentElement.classList.add('flip-in');
    }

    // Add click outside listener after a small delay to avoid immediate close
    setTimeout(() => {
      this.clickOutsideHandler = (e: MouseEvent) => {
        // Check if click is outside the popover
        if (!this.contains(e.target as Node)) {
          this.hide();
        }
      };
      document.addEventListener('click', this.clickOutsideHandler, true);
    }, 100);

    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
    }
    this.keydownHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.keydownHandler, true);
  }

  hide(): void {
    if (this.isAnimating) return;

    // Remove click outside listener
    if (this.clickOutsideHandler) {
      document.removeEventListener('click', this.clickOutsideHandler, true);
      this.clickOutsideHandler = null;
    }

    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }

    // Check if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (this.contentElement && !prefersReducedMotion) {
      this.isAnimating = true;
      this.contentElement.classList.remove('flip-in');
      this.contentElement.classList.add('flip-out');

      // Wait for animation to complete before hiding
      const animationDuration = 100; // matches fadeOut duration
      this.hideTimeoutId = window.setTimeout(() => {
        this.hidePopover();
        this.isAnimating = false;
        this.hideTimeoutId = null;
        this.dispatchEvent(new CustomEvent('proofly:popover-hide'));
      }, animationDuration);
    } else {
      // No animation, hide immediately
      this.hidePopover();
      this.dispatchEvent(new CustomEvent('proofly:popover-hide'));
    }
  }

  private updateContent(): void {
    if (!this.currentCorrection || !this.contentElement) return;

    const colors = getCorrectionTypeColor(this.currentCorrection.type);
    const content = this.contentElement;

    if (!content) return;

    content.innerHTML = `
      <div class="correction-header">
        <span class="correction-type" style="background: ${colors.background}; color: ${colors.color}; border: 1px solid ${colors.border};">
          ${colors.label}
        </span>
        <button class="close-button" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="correction-body">
        <div class="correction-suggestion">
          <strong>Suggestion:</strong> ${this.escapeHtml(this.currentCorrection.correction)}
        </div>
        ${this.currentCorrection.explanation ? `
          <div class="correction-explanation">
            ${this.escapeHtml(this.currentCorrection.explanation)}
          </div>
        ` : ''}
      </div>
      <div class="correction-actions">
        <button class="apply-button">Apply Fix</button>
      </div>
    `;

    const applyButton = content.querySelector('.apply-button');
    if (applyButton && this.currentCorrection && this.onApply) {
      const correction = this.currentCorrection;
      const handler = this.onApply;
      applyButton.addEventListener('click', () => {
        handler(correction);
        this.hide();
      });
    }

    const closeButton = content.querySelector('.close-button');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        this.hide();
      });
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private getStyles(): string {
    return `
      :host {
        position: fixed;
        z-index: 10000;
        margin: 0;
        padding: 0;
        border: none;
        max-width: 320px;
        min-width: 180px;
        background: transparent;
        overflow: hidden;
      }

      :host::backdrop {
        background: transparent;
      }

      @keyframes flipYIn {
        0% {
          opacity: 0;
          transform: perspective(800px) rotateX(-45deg);
        }
        99.9% {
          opacity: 1;
          transform: perspective(800px) rotateX(0deg);
        }
        100% {
          opacity: 1;
          transform: none;
        }
      }

      @keyframes fadeOut {
        0% {
          opacity: 1;
        }
        100% {
          opacity: 0;
        }
      }

      .popover-content {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
        padding: 0;
        overflow-x: hidden;
        overflow-y: hidden;
      }

      .popover-content.flip-in {
        animation: flipYIn 150ms ease-out forwards;
      }

      .popover-content.flip-out {
        animation: fadeOut 100ms ease-in forwards;
      }

      @media (prefers-reduced-motion: reduce) {
        .popover-content.flip-in,
        .popover-content.flip-out {
          animation: none;
        }
      }

      .correction-header {
        padding: 0.75rem;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }

      .correction-type {
        padding: 0.25rem 0.75rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: capitalize;
      }

      .close-button {
        background: transparent;
        border: none;
        color: #6b7280;
        font-size: 1rem;
        line-height: 1;
        cursor: pointer;
        padding: 0.25rem 0.40rem;
        border-radius: 6px;
        transition: background 0.2s, color 0.2s;
      }

      .close-button:hover {
        background: #f3f4f6;
        color: #111827;
      }

      .correction-body {
        padding: 0.75rem;
      }

      .correction-suggestion {
        font-size: 0.875rem;
        color: #111827;
        margin-bottom: 0.5rem;
      }

      .correction-suggestion strong {
        font-weight: 600;
        color: #374151;
      }

      .correction-explanation {
        font-size: 0.75rem;
        color: #6b7280;
        line-height: 1.5;
        font-style: italic;
      }

      .correction-actions {
        padding: 0.75rem;
        border-top: 1px solid #e5e7eb;
        background: #f9fafb;
      }

      .apply-button {
        width: 100%;
        background: #4f46e5;
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 0.375rem;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }

      .apply-button:hover {
        background: #4338ca;
      }

      .apply-button:active {
        background: #3730a3;
      }
    `;
  }

  private render(): void {
    if (!this.shadowRoot) return;

    const style = document.createElement('style');
    style.textContent = this.getStyles();

    const content = document.createElement('div');
    content.className = 'popover-content';

    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(content);

    this.contentElement = content;
  }
}

customElements.define('proofly-correction-popover', CorrectionPopover);
