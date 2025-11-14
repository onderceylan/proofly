import { getCorrectionTypeColor } from '../../shared/utils/correction-types.ts';
import { createUniqueId } from '../utils.ts';

type AnchorState = {
  owns: string | null;
  controls: string | null;
};

export class CorrectionPopover extends HTMLElement {
  private readonly internals: ElementInternals | null;
  private contentElement: HTMLDivElement | null = null;
  private currentCorrection: ProofreadCorrection | null = null;
  private issueText: string = '';
  private onApply: ((correction: ProofreadCorrection) => void) | null = null;
  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private isAnimating: boolean = false;
  private hideTimeoutId: number | null = null;
  private anchorElement: HTMLElement | null = null;
  private readonly anchorAriaCache = new WeakMap<HTMLElement, AnchorState>();
  private popoverId: string;
  private suggestionElementId: string;

  constructor() {
    super();
    this.internals = tryAttachInternals(this);
    this.attachShadow({ mode: 'open' });
    this.popoverId = createUniqueId('popover');
    this.suggestionElementId = `${this.popoverId}-suggestion`;
  }

  connectedCallback() {
    if (!this.id) {
      this.id = this.popoverId;
    } else {
      this.popoverId = this.id;
      this.suggestionElementId = `${this.popoverId}-suggestion`;
    }
    this.setAttribute('popover', 'manual');
    this.setAttribute('tabindex', '-1');
    this.applyBaseAriaAttributes();
    this.render();
  }

  disconnectedCallback() {
    this.restoreAnchorElement();
  }

  private applyBaseAriaAttributes(): void {
    if (this.internals) {
      this.internals.role = 'dialog';
      this.internals.ariaLive = 'assertive';
      this.internals.ariaModal = 'false';
    } else {
      this.setAttribute('role', 'dialog');
      this.setAttribute('aria-live', 'assertive');
      this.setAttribute('aria-modal', 'false');
    }
  }

  setCorrection(
    correction: ProofreadCorrection,
    issueText: string,
    onApply: (correction: ProofreadCorrection) => void
  ): void {
    this.currentCorrection = correction;
    this.issueText = issueText;
    this.onApply = onApply;
    this.updateContent();
  }

  show(x: number, y: number, options?: { anchorElement?: HTMLElement }): void {
    this.setAnchorElement(options?.anchorElement ?? null);
    // Cancel any pending hide animation
    if (this.hideTimeoutId !== null) {
      clearTimeout(this.hideTimeoutId);
      this.hideTimeoutId = null;
      this.isAnimating = false;
    }

    // Show popover first to get its dimensions
    this.showPopover();
    this.focus({ preventScroll: true });

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
        this.restoreAnchorElement();
        this.isAnimating = false;
        this.hideTimeoutId = null;
        this.dispatchEvent(new CustomEvent('proofly:popover-hide'));
      }, animationDuration);
    } else {
      // No animation, hide immediately
      this.hidePopover();
      this.restoreAnchorElement();
      this.dispatchEvent(new CustomEvent('proofly:popover-hide'));
    }
  }

  private updateContent(): void {
    if (!this.currentCorrection || !this.contentElement) return;

    const colors = getCorrectionTypeColor(this.currentCorrection.type);
    const content = this.contentElement;

    if (!content) return;

    const suggestionDisplay = this.formatSuggestion(
      this.currentCorrection.correction,
      this.issueText
    );

    content.innerHTML = `
      <div class="correction-header">
        <span class="correction-type" style="background: ${colors.background}; color: ${colors.color}; border: 1px solid ${colors.border};">
          ${colors.label}
        </span>
        <button class="close-button" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="correction-body">
        <div class="correction-suggestion">
          <strong>Suggestion:</strong> <span
            id="${this.suggestionElementId}"
            data-role="suggestion-text"
          >${suggestionDisplay}</span>
        </div>
        ${
          this.currentCorrection.explanation
            ? `
          <div class="correction-explanation">
            ${this.escapeHtml(this.currentCorrection.explanation)}
          </div>
        `
            : ''
        }
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

    const suggestionElement = content.querySelector(
      '[data-role="suggestion-text"]'
    ) as HTMLElement | null;
    this.applyAccessibleMetadata(this.buildAriaLabel(colors.label), suggestionElement);
  }

  private applyAccessibleMetadata(label: string, descriptionElement: HTMLElement | null): void {
    const internals = this.internals;
    if (internals) {
      internals.ariaLabel = label;
      if ('ariaDescribedByElements' in internals) {
        (internals as unknown as { ariaDescribedByElements: Element[] }).ariaDescribedByElements =
          descriptionElement ? [descriptionElement] : [];
        return;
      }
    }

    this.setAttribute('aria-label', label);
    if (descriptionElement) {
      descriptionElement.id = this.suggestionElementId;
      this.setAttribute('aria-describedby', this.suggestionElementId);
    } else {
      this.removeAttribute('aria-describedby');
    }
  }

  private buildAriaLabel(typeLabel: string): string {
    const suggestion = this.getAccessibleSuggestionText();
    if (suggestion) {
      return `${typeLabel} suggestion: ${suggestion}`;
    }
    return `${typeLabel} suggestion`;
  }

  private getAccessibleSuggestionText(): string | null {
    const value = this.currentCorrection?.correction;
    if (typeof value === 'string') {
      if (value === ' ') {
        return 'space character';
      }
      if (value === '') {
        return 'remove highlighted text';
      }
      if (value.trim().length === 0) {
        return 'whitespace adjustment';
      }
      return value.trim();
    }

    const trimmedIssue = this.issueText.trim();
    if (trimmedIssue.length > 0) {
      return trimmedIssue;
    }
    return null;
  }

  private setAnchorElement(element: HTMLElement | null): void {
    if (this.anchorElement === element) {
      return;
    }

    this.restoreAnchorElement();

    if (!element) {
      return;
    }

    if (!this.anchorAriaCache.has(element)) {
      this.anchorAriaCache.set(element, {
        owns: element.getAttribute('aria-owns'),
        controls: element.getAttribute('aria-controls'),
      });
    }

    const popoverId = this.id || this.popoverId;
    element.setAttribute('aria-owns', mergeIds(element.getAttribute('aria-owns'), popoverId));
    element.setAttribute(
      'aria-controls',
      mergeIds(element.getAttribute('aria-controls'), popoverId)
    );
    this.anchorElement = element;
  }

  private restoreAnchorElement(): void {
    if (!this.anchorElement) {
      return;
    }

    const cached = this.anchorAriaCache.get(this.anchorElement);
    if (cached?.owns) {
      this.anchorElement.setAttribute('aria-owns', cached.owns);
    } else {
      this.anchorElement.removeAttribute('aria-owns');
    }

    if (cached?.controls) {
      this.anchorElement.setAttribute('aria-controls', cached.controls);
    } else {
      this.anchorElement.removeAttribute('aria-controls');
    }

    this.anchorAriaCache.delete(this.anchorElement);
    this.anchorElement = null;
  }

  private formatSuggestion(suggestion: string, issueText: string): string {
    const escapedSuggestion = this.escapeHtml(suggestion);

    if (escapedSuggestion === '') {
      return `<span class="clipped" style="text-decoration: line-through; color: var(--color-error);">${this.escapeHtml(issueText)}</span>`;
    }

    if (suggestion === ' ') {
      return '" "';
    }

    return escapedSuggestion;
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

        --color-surface: #ffffff;
        --color-border: #e5e7eb;
        --color-text-primary: #111827;
        --color-text-secondary: #374151;
        --color-text-tertiary: #6b7280;
        --color-surface-subtle: #f9fafb;
        --color-surface-hover: #f3f4f6;
        --color-primary: #4f46e5;
        --color-primary-hover: #4338ca;
        --color-primary-active: #3730a3;
        --color-on-primary: #ffffff;
        --color-error: #dc2626;
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
        background: var(--color-surface);
        border: 1px solid var(--color-border);
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
        border-bottom: 1px solid var(--color-border);
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
        color: var(--color-text-tertiary);
        font-size: 1rem;
        line-height: 1;
        cursor: pointer;
        padding: 0.25rem 0.40rem;
        border-radius: 6px;
        transition: background 0.2s, color 0.2s;
      }

      .close-button:hover {
        background: var(--color-surface-hover);
        color: var(--color-text-primary);
      }

      .correction-body {
        padding: 0.75rem;
      }

      .correction-suggestion {
        font-size: 0.875rem;
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
      }

      .correction-suggestion strong {
        font-weight: 600;
        color: var(--color-text-secondary);
      }
      
      .correction-suggestion .clipped {
        max-width: 20ch;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .correction-explanation {
        font-size: 0.75rem;
        color: var(--color-text-tertiary);
        line-height: 1.5;
        font-style: italic;
      }

      .correction-actions {
        padding: 0.75rem;
        border-top: 1px solid var(--color-border);
        background: var(--color-surface-subtle);
      }

      .apply-button {
        width: 100%;
        background: var(--color-primary);
        color: var(--color-on-primary);
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 0.375rem;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }

      .apply-button:hover {
        background: var(--color-primary-hover);
      }

      .apply-button:active {
        background: var(--color-primary-active);
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

function mergeIds(existing: string | null, id: string): string {
  const values = new Set<string>();
  if (existing) {
    for (const value of existing.split(/\s+/)) {
      if (value) {
        values.add(value);
      }
    }
  }
  values.add(id);
  return Array.from(values).join(' ');
}

function tryAttachInternals(element: HTMLElement): ElementInternals | null {
  if (typeof element.attachInternals !== 'function') {
    return null;
  }

  try {
    return element.attachInternals();
  } catch (_error) {
    return null;
  }
}
