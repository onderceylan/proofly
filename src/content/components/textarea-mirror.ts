/**
 * TextareaMirror - Creates an invisible contenteditable mirror of textarea/input elements
 *
 * This component solves the CSS Custom Highlights API limitation with textarea/input elements
 * by creating a contenteditable div overlay that:
 * 1. Perfectly mirrors the textarea's styling
 * 2. Syncs text content, scroll position, and dimensions
 * 3. Allows CSS Custom Highlights API to work (since it's contenteditable)
 * 4. Uses pointer-events: none to remain invisible to user interaction
 */

export class TextareaMirror {
  private mirrorElement: HTMLDivElement;
  private textareaElement: HTMLTextAreaElement | HTMLInputElement;
  private cleanup: Array<() => void> = [];
  private lastWidth = 0;
  private lastHeight = 0;
  private lastTop = 0;
  private lastLeft = 0;

  constructor(textarea: HTMLTextAreaElement | HTMLInputElement) {
    this.textareaElement = textarea;
    this.mirrorElement = this.createMirrorElement();
    this.setupEventListeners();
    this.initialSync();
  }

  private createMirrorElement(): HTMLDivElement {
    const mirror = document.createElement('div');
    // Note: We need contentEditable for CSS Custom Highlights API to work
    // But we prevent all editing via event listeners below
    mirror.contentEditable = 'true';
    mirror.setAttribute('data-proofly-mirror', 'true');
    mirror.setAttribute('tabindex', '-1'); // Prevent tab focus

    // Base styling for mirror overlay
    mirror.style.cssText = `
      position: absolute;
      pointer-events: auto;
      overflow: hidden;
      white-space: pre-wrap;
      word-wrap: break-word;
      z-index: 1;
      color: transparent;
      user-select: none;
      caret-color: transparent;
      background: transparent;
    `;

    // Prevent the mirror from actually being editable (block all input events)
    mirror.addEventListener('beforeinput', (e) => e.preventDefault());
    mirror.addEventListener('input', (e) => e.preventDefault());
    mirror.addEventListener('keydown', (e) => e.preventDefault());
    mirror.addEventListener('keypress', (e) => e.preventDefault());
    mirror.addEventListener('keyup', (e) => e.preventDefault());
    mirror.addEventListener('paste', (e) => e.preventDefault());
    mirror.addEventListener('cut', (e) => e.preventDefault());
    mirror.addEventListener('drop', (e) => e.preventDefault());

    // Redirect focus to the actual textarea
    mirror.addEventListener('focus', (e) => {
      e.preventDefault();
      if (this.textareaElement) {
        this.textareaElement.focus();
      }
    });

    // Redirect mousedown to prevent focus
    mirror.addEventListener('mousedown', (e) => {
      // Don't prevent default on click - we need it for popover
      // Only blur the mirror if it somehow got focus
      if (document.activeElement === mirror) {
        e.preventDefault();
        if (this.textareaElement) {
          this.textareaElement.focus();
        }
      }
    });

    return mirror;
  }

  private setupEventListeners(): void {
    // Sync on input
    const handleInput = () => {
      this.syncText();
    };
    this.textareaElement.addEventListener('input', handleInput);
    this.cleanup.push(() => this.textareaElement.removeEventListener('input', handleInput));

    // Sync on scroll
    const handleScroll = () => {
      this.syncScroll();
    };
    this.textareaElement.addEventListener('scroll', handleScroll);
    this.cleanup.push(() => this.textareaElement.removeEventListener('scroll', handleScroll));

    // Note: ResizeObserver disabled to prevent dimension oscillation
    // The mirror dimensions are set once on initialization and remain stable
    // If truly dynamic resizing is needed, use debouncing (e.g., 100ms delay)

    // Sync on window resize/scroll (for fixed/sticky positioning)
    const handleWindowEvent = () => {
      this.syncPosition();
    };
    window.addEventListener('resize', handleWindowEvent);
    window.addEventListener('scroll', handleWindowEvent, true);
    this.cleanup.push(() => {
      window.removeEventListener('resize', handleWindowEvent);
      window.removeEventListener('scroll', handleWindowEvent, true);
    });
  }

  private initialSync(): void {
    this.syncStyles();
    this.syncText();
    this.syncPosition();
    this.syncDimensions();
    this.syncScroll();
  }

  private syncStyles(): void {
    const computedStyle = window.getComputedStyle(this.textareaElement);

    // Typography styles
    const stylesToCopy = [
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'font-variant',
      'line-height',
      'letter-spacing',
      'word-spacing',
      'text-transform',
      'text-indent',
      'text-align',

      // Box model
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'border-top-width',
      'border-right-width',
      'border-bottom-width',
      'border-left-width',
      'box-sizing',

      // Text wrapping
      'white-space',
      'word-wrap',
      'word-break',
      'overflow-wrap',
    ];

    stylesToCopy.forEach(prop => {
      this.mirrorElement.style.setProperty(prop, computedStyle.getPropertyValue(prop));
    });
  }

  private syncText(): void {
    const text = this.textareaElement.value;

    // Handle empty text
    if (!text) {
      this.mirrorElement.textContent = '\u200B'; // Zero-width space to maintain height
      return;
    }

    // Add zero-width space if ends with newline (for proper measurement)
    this.mirrorElement.textContent = text.endsWith('\n') ? text + '\u200B' : text;
  }

  private syncPosition(): void {
    const rect = this.textareaElement.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(this.textareaElement);

    // Get border widths
    const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
    const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;

    // Calculate new position (use Math.round to avoid subpixels)
    const newTop = Math.round(rect.top + window.scrollY + borderTop);
    const newLeft = Math.round(rect.left + window.scrollX + borderLeft);

    // Only update if changed by more than 1px to avoid jitter
    if (Math.abs(newTop - this.lastTop) > 1 || Math.abs(newLeft - this.lastLeft) > 1) {
      this.mirrorElement.style.top = `${newTop}px`;
      this.mirrorElement.style.left = `${newLeft}px`;
      this.lastTop = newTop;
      this.lastLeft = newLeft;
    }
  }

  private syncDimensions(): void {
    // If we already have dimensions set and they're close enough, skip update to prevent oscillation
    if (this.lastWidth > 0 && this.lastHeight > 0) {
      const currentWidth = parseInt(this.mirrorElement.style.width) || 0;
      const currentHeight = parseInt(this.mirrorElement.style.height) || 0;

      // If current dimensions are already set and stable, don't recalculate
      if (currentWidth > 0 && currentHeight > 0) {
        return;
      }
    }

    const rect = this.textareaElement.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(this.textareaElement);

    // Get borders and padding
    const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
    const borderRight = parseFloat(computedStyle.borderRightWidth) || 0;
    const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;
    const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;

    // Calculate new dimensions (use Math.floor to avoid overflow and scrollbars)
    const newWidth = Math.floor(rect.width - borderLeft - borderRight);
    const newHeight = Math.floor(rect.height - borderTop - borderBottom);

    // Set dimensions only once on initial sync
    if (this.lastWidth === 0 || this.lastHeight === 0) {
      this.mirrorElement.style.width = `${newWidth}px`;
      this.mirrorElement.style.height = `${newHeight}px`;
      this.lastWidth = newWidth;
      this.lastHeight = newHeight;
    }
  }

  private syncScroll(): void {
    const scrollTop = this.textareaElement.scrollTop;
    const scrollLeft = this.textareaElement.scrollLeft;

    // Use transform for smooth scrolling
    this.mirrorElement.style.transform = `translate(-${scrollLeft}px, -${scrollTop}px)`;
  }

  /**
   * Returns the mirror element for use with ContentHighlighter
   */
  getElement(): HTMLDivElement {
    return this.mirrorElement;
  }

  /**
   * Attaches the mirror to the DOM
   */
  attach(): void {
    // Insert mirror right after the textarea in DOM
    if (this.textareaElement.parentNode) {
      this.textareaElement.parentNode.insertBefore(
        this.mirrorElement,
        this.textareaElement.nextSibling
      );
    }
  }

  /**
   * Detaches and cleans up the mirror
   */
  destroy(): void {
    this.cleanup.forEach(fn => fn());
    this.cleanup = [];

    if (this.mirrorElement.parentNode) {
      this.mirrorElement.parentNode.removeChild(this.mirrorElement);
    }
  }
}
