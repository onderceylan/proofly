import { getCorrectionTypeColor } from '../../shared/utils/correction-colors.ts';

export class CorrectionPopover extends HTMLElement {
  private contentElement: HTMLDivElement | null = null;
  private currentCorrection: ProofreadCorrection | null = null;
  private onApply: ((correction: ProofreadCorrection) => void) | null = null;
  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

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
    // Show popover first to get its dimensions
    this.showPopover();

    // Get popover dimensions
    const rect = this.getBoundingClientRect();
    const margin = 10; // Minimum margin from viewport edge

    // Adjust x to keep popover within viewport (horizontal bounds)
    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - margin;
    }
    if (x < margin) {
      x = margin;
    }

    // Adjust y to keep popover within viewport (vertical bounds)
    if (y + rect.height > window.innerHeight + window.scrollY) {
      y = window.innerHeight + window.scrollY - rect.height - margin;
    }
    if (y < window.scrollY + margin) {
      y = window.scrollY + margin;
    }

    this.style.left = `${x}px`;
    this.style.top = `${y}px`;

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
  }

  hide(): void {
    // Remove click outside listener
    if (this.clickOutsideHandler) {
      document.removeEventListener('click', this.clickOutsideHandler, true);
      this.clickOutsideHandler = null;
    }

    this.hidePopover();
    this.dispatchEvent(new CustomEvent('proofly:popover-hide'));
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
        background: transparent;
      }

      :host::backdrop {
        background: transparent;
      }

      .popover-content {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
        padding: 0;
        overflow: hidden;
      }

      .correction-header {
        padding: 0.75rem;
        border-bottom: 1px solid #e5e7eb;
      }

      .correction-type {
        padding: 0.25rem 0.75rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: capitalize;
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
