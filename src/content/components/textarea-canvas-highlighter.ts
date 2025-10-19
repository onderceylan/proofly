/**
 * TextareaCanvasHighlighter - Canvas-based highlighting for textarea/input elements
 *
 * Simple approach: Absolutely positioned canvas overlay
 */

import { CORRECTION_TYPE_COLORS } from '../../shared/utils/correction-colors.ts';

export class TextareaCanvasHighlighter {
  private textarea: HTMLTextAreaElement | HTMLInputElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private corrections: ProofreadCorrection[] = [];
  private cleanup: Array<() => void> = [];
  private measureDiv: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private clickedCorrection: ProofreadCorrection | null = null;

  constructor(textarea: HTMLTextAreaElement | HTMLInputElement) {
    this.textarea = textarea;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'proofly-canvas';
    this.canvas.style.cssText = `
      position: absolute;
      pointer-events: none;
      z-index: 1;
    `;

    // Get canvas context
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to get canvas 2d context');
    }
    this.ctx = context;

    // Insert canvas after textarea
    this.textarea.parentNode?.insertBefore(this.canvas, this.textarea.nextSibling);

    // Sync dimensions
    this.syncDimensions();

    // Setup event listeners
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Redraw on scroll
    const handleScroll = () => {
      this.redraw();
    };
    this.textarea.addEventListener('scroll', handleScroll);
    this.cleanup.push(() => this.textarea.removeEventListener('scroll', handleScroll));

    // Redraw on input (text changes)
    const handleInput = () => {
      requestAnimationFrame(() => this.redraw());
    };
    this.textarea.addEventListener('input', handleInput);
    this.cleanup.push(() => this.textarea.removeEventListener('input', handleInput));

    // Redraw on resize
    this.resizeObserver = new ResizeObserver(() => {
      this.syncDimensions();
      this.redraw();
    });
    this.resizeObserver.observe(this.textarea);

    // Redraw on window resize (canvas position may change)
    const handleWindowResize = () => {
      this.syncDimensions();
      this.redraw();
    };
    window.addEventListener('resize', handleWindowResize);
    this.cleanup.push(() => window.removeEventListener('resize', handleWindowResize));

    // Handle clicks on textarea to check if clicking on a highlight
    const handleTextareaClick = (e: Event) => {
      const mouseEvent = e as MouseEvent;
      const rect = this.textarea.getBoundingClientRect();
      const x = mouseEvent.clientX - rect.left;
      const y = mouseEvent.clientY - rect.top;

      const correction = this.findCorrectionAtPoint(x, y);
      if (correction) {
        // Set clicked correction and redraw to show background highlight
        this.clickedCorrection = correction;
        this.redraw();

        if (this.onCorrectionClick) {
          mouseEvent.preventDefault();
          mouseEvent.stopPropagation();
          this.onCorrectionClick(correction, mouseEvent.clientX, mouseEvent.clientY);
        }
      } else {
        // Clear clicked correction if clicking outside highlights
        if (this.clickedCorrection) {
          this.clickedCorrection = null;
          this.redraw();
        }
      }
    };
    this.textarea.addEventListener('click', handleTextareaClick);
    this.cleanup.push(() => this.textarea.removeEventListener('click', handleTextareaClick));
  }

  private syncDimensions(): void {
    const rect = this.textarea.getBoundingClientRect();

    // Position canvas to overlay textarea
    this.canvas.style.top = (rect.top + window.scrollY) + 'px';
    this.canvas.style.left = (rect.left + window.scrollX) + 'px';
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';

    // Set canvas internal dimensions
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  /**
   * Draw highlights for the given corrections
   */
  drawHighlights(corrections: ProofreadCorrection[]): void {
    this.corrections = corrections;
    // Clear clicked correction if it's no longer in the corrections list
    if (this.clickedCorrection && !corrections.includes(this.clickedCorrection)) {
      this.clickedCorrection = null;
    }
    this.redraw();
  }

  /**
   * Clear all highlights
   */
  clearHighlights(): void {
    this.corrections = [];
    this.clickedCorrection = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private redraw(): void {
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.corrections.length === 0) {
      return;
    }

    // Get textarea metrics
    const scrollTop = this.textarea.scrollTop;
    const scrollLeft = this.textarea.scrollLeft;
    const style = window.getComputedStyle(this.textarea);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;

    // Draw each correction
    for (const correction of this.corrections) {
      const ranges = this.getCharacterRanges(correction.startIndex, correction.endIndex);
      const isClicked = this.clickedCorrection === correction;

      for (const range of ranges) {
        const x = range.x - scrollLeft + paddingLeft;
        const y = range.y - scrollTop + paddingTop;

        // Draw background highlight if this correction is clicked
        if (isClicked) {
          this.drawBackground(x, y, range.width, range.height, correction.type || 'spelling');
        }

        // Draw underline
        this.drawUnderline(x, y, range.width, range.height, correction.type || 'spelling');
      }
    }
  }

  private drawBackground(x: number, y: number, width: number, height: number, type: string): void {
    const colors = CORRECTION_TYPE_COLORS[type as keyof typeof CORRECTION_TYPE_COLORS] || CORRECTION_TYPE_COLORS.spelling;

    // Draw semi-transparent background
    this.ctx.fillStyle = colors.color;
    this.ctx.globalAlpha = 0.15; // Low opacity for background
    this.ctx.fillRect(x, y, width, height);
    this.ctx.globalAlpha = 1.0; // Reset alpha
  }

  private drawUnderline(x: number, y: number, width: number, height: number, type: string): void {
    const colors = CORRECTION_TYPE_COLORS[type as keyof typeof CORRECTION_TYPE_COLORS] || CORRECTION_TYPE_COLORS.spelling;

    // Draw wavy underline
    this.ctx.strokeStyle = colors.color;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();

    const waveHeight = 2;
    const waveLength = 4;
    const baseY = y + height - 1; // Position underline 2px lower (was -3, now -1)

    for (let i = 0; i <= width; i += waveLength) {
      const waveY = baseY + (Math.sin(i / waveLength * Math.PI) * waveHeight);
      if (i === 0) {
        this.ctx.moveTo(x, waveY);
      } else {
        this.ctx.lineTo(x + i, waveY);
      }
    }

    this.ctx.stroke();
  }

  private getCharacterRanges(start: number, end: number): Array<{x: number, y: number, width: number, height: number}> {
    const measureDiv = this.getOrCreateMeasureDiv();
    const text = this.textarea.value;
    const ranges: Array<{x: number, y: number, width: number, height: number}> = [];

    // Get textarea metrics
    const style = window.getComputedStyle(this.textarea);

    // Measure actual line height by creating two lines and measuring the difference
    measureDiv.textContent = 'X';
    const singleLineHeight = measureDiv.offsetHeight;
    measureDiv.innerHTML = 'X<br>X';
    const doubleLineHeight = measureDiv.offsetHeight;
    const lineHeight = doubleLineHeight - singleLineHeight;

    // Get content width (textarea width minus padding)
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const contentWidth = this.textarea.clientWidth - paddingLeft - paddingRight;

    // Build array of visual lines considering wrapping
    const visualLines: Array<{text: string, startIndex: number}> = [];
    const hardLines = text.split('\n');
    let currentIndex = 0;

    for (const hardLine of hardLines) {
      if (hardLine.length === 0) {
        visualLines.push({ text: '', startIndex: currentIndex });
        currentIndex += 1; // for the \n
        continue;
      }

      // Split hard line into visual lines based on width (word-wrap)
      let lineStart = 0;
      let currentLine = '';
      let lastSpaceIndex = -1;
      let lastSpaceInLine = -1;

      for (let i = 0; i < hardLine.length; i++) {
        const char = hardLine[i];
        const testLine = currentLine + char;
        measureDiv.textContent = testLine;
        const testWidth = measureDiv.offsetWidth;

        // Track last space position for word wrapping
        if (char === ' ') {
          lastSpaceIndex = i;
          lastSpaceInLine = currentLine.length;
        }

        if (testWidth > contentWidth && currentLine.length > 0) {
          // Overflow detected - wrap at last space if available
          if (lastSpaceInLine > 0) {
            // Wrap at last space (word boundary)
            const lineText = currentLine.substring(0, lastSpaceInLine);
            visualLines.push({ text: lineText, startIndex: currentIndex + lineStart });
            lineStart = lastSpaceIndex + 1; // Skip the space
            currentLine = hardLine.substring(lastSpaceIndex + 1, i + 1);
            lastSpaceInLine = -1;
          } else {
            // No space found, break at character (shouldn't happen often with normal text)
            visualLines.push({ text: currentLine, startIndex: currentIndex + lineStart });
            lineStart = i;
            currentLine = char;
          }
        } else {
          currentLine = testLine;
        }
      }

      // Add remaining text
      if (currentLine.length > 0) {
        visualLines.push({ text: currentLine, startIndex: currentIndex + lineStart });
      }

      currentIndex += hardLine.length + 1; // +1 for \n
    }

    // Now find ranges within visual lines
    for (let visualLineIndex = 0; visualLineIndex < visualLines.length; visualLineIndex++) {
      const visualLine = visualLines[visualLineIndex];
      const lineStart = visualLine.startIndex;
      const lineEnd = lineStart + visualLine.text.length;

      // Check if this visual line contains part of the correction
      if (lineEnd >= start && lineStart < end) {
        const rangeStart = Math.max(start - lineStart, 0);
        const rangeEnd = Math.min(end - lineStart, visualLine.text.length);

        // Measure text to get coordinates
        const beforeText = visualLine.text.substring(0, rangeStart);
        const rangeText = visualLine.text.substring(rangeStart, rangeEnd);

        measureDiv.textContent = beforeText;
        const x = measureDiv.offsetWidth;

        measureDiv.textContent = rangeText;
        const width = measureDiv.offsetWidth;

        const y = visualLineIndex * lineHeight;

        ranges.push({ x, y, width, height: lineHeight });
      }
    }

    return ranges;
  }

  private getOrCreateMeasureDiv(): HTMLDivElement {
    if (!this.measureDiv) {
      this.measureDiv = document.createElement('div');
      const textareaStyle = window.getComputedStyle(this.textarea);

      this.measureDiv.style.cssText = `
        position: absolute;
        visibility: hidden;
        white-space: pre;
        font-family: ${textareaStyle.fontFamily};
        font-size: ${textareaStyle.fontSize};
        font-weight: ${textareaStyle.fontWeight};
        letter-spacing: ${textareaStyle.letterSpacing};
        word-spacing: ${textareaStyle.wordSpacing};
        line-height: ${textareaStyle.lineHeight};
      `;

      document.body.appendChild(this.measureDiv);
      this.cleanup.push(() => {
        this.measureDiv?.remove();
        this.measureDiv = null;
      });
    }

    return this.measureDiv;
  }

  private findCorrectionAtPoint(x: number, y: number): ProofreadCorrection | null {
    const scrollTop = this.textarea.scrollTop;
    const scrollLeft = this.textarea.scrollLeft;
    const style = window.getComputedStyle(this.textarea);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;

    // Adjust for scroll and padding
    const adjustedX = x + scrollLeft - paddingLeft;
    const adjustedY = y + scrollTop - paddingTop;

    // Check each correction
    for (const correction of this.corrections) {
      const ranges = this.getCharacterRanges(correction.startIndex, correction.endIndex);

      for (const range of ranges) {
        if (
          adjustedX >= range.x &&
          adjustedX <= range.x + range.width &&
          adjustedY >= range.y &&
          adjustedY <= range.y + range.height
        ) {
          return correction;
        }
      }
    }

    return null;
  }

  /**
   * Callback for when a correction is clicked
   */
  private onCorrectionClick: ((correction: ProofreadCorrection, x: number, y: number) => void) | null = null;

  /**
   * Set callback for correction clicks
   */
  setOnCorrectionClick(callback: (correction: ProofreadCorrection, x: number, y: number) => void): void {
    this.onCorrectionClick = callback;
  }

  /**
   * Returns the canvas element
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Returns the original textarea element
   */
  getTextarea(): HTMLTextAreaElement | HTMLInputElement {
    return this.textarea;
  }

  /**
   * Cleanup and remove the highlighter
   */
  destroy(): void {
    this.cleanup.forEach(fn => fn());
    this.cleanup = [];

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.canvas.remove();
    this.onCorrectionClick = null;
  }
}
