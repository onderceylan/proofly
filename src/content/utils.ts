import { logger } from '../services/logger.ts';

export interface PaddingBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ContentBoxMetrics {
  border: PaddingBox;
  padding: PaddingBox;
  scrollBar: { horizontal: number; vertical: number };
  rect: DOMRect;
}

export function getBoxMetrics(target: HTMLElement): ContentBoxMetrics {
  const rect = target.getBoundingClientRect();
  const style = getComputedStyle(target);
  const border = {
    top: parseFloat(style.borderTopWidth) || 0,
    right: parseFloat(style.borderRightWidth) || 0,
    bottom: parseFloat(style.borderBottomWidth) || 0,
    left: parseFloat(style.borderLeftWidth) || 0,
  } satisfies PaddingBox;

  const padding = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  } satisfies PaddingBox;

  const scrollBar = {
    vertical: target.offsetWidth - target.clientWidth - border.left - border.right,
    horizontal: target.offsetHeight - target.clientHeight - border.top - border.bottom,
  };

  return { border, padding, scrollBar, rect };
}

export function cloneTextStyles(source: HTMLElement, destination: HTMLElement): void {
  const computed = getComputedStyle(source);
  const map: Array<[string, string]> = [
    ['font-family', computed.fontFamily],
    ['font-size', computed.fontSize],
    ['font-weight', computed.fontWeight],
    ['font-style', computed.fontStyle],
    ['font-variant', computed.fontVariant],
    ['letter-spacing', computed.letterSpacing],
    ['word-spacing', computed.wordSpacing],
    ['line-height', computed.lineHeight],
    ['text-transform', computed.textTransform],
    ['direction', computed.direction],
    ['tab-size', computed.tabSize],
    ['white-space', computed.whiteSpace],
    ['text-indent', computed.textIndent],
    ['text-align', computed.textAlign],
    ['padding-top', computed.paddingTop],
    ['padding-right', computed.paddingRight],
    ['padding-bottom', computed.paddingBottom],
    ['padding-left', computed.paddingLeft],
  ];

  for (const [property, value] of map) {
    destination.style.setProperty(property, value);
  }
}

export function valueToMirrorNodes(value: string, isTextarea: boolean): Text[] {
  const normalized = isTextarea ? normalizeTextareaValue(value) : normalizeInputValue(value);
  return [document.createTextNode(normalized)];
}

function normalizeTextareaValue(value: string): string {
  const normalized = value.replace(/\r\n|\r/g, '\n');
  return normalized;
}

function normalizeInputValue(value: string): string {
  return value.replace(/\r\n|\r/g, '\n');
}

export function debounce<T extends (...args: Parameters<T>) => void>(
  callback: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = self.setTimeout(() => {
      timeoutId = null;
      callback(...args);
    }, wait);
  };
}

export function computeLineHeight(target: HTMLElement, fallbackMultiplier = 1.2): number {
  const style = getComputedStyle(target);
  if (style.lineHeight === 'normal') {
    const fontSize = parseFloat(style.fontSize) || 16;
    return fontSize * fallbackMultiplier;
  }
  const value = parseFloat(style.lineHeight);
  if (Number.isNaN(value)) {
    logger.warn({ lineHeight: style.lineHeight }, 'Failed to parse line-height, using fallback');
    const fontSize = parseFloat(style.fontSize) || 16;
    return fontSize * fallbackMultiplier;
  }
  return value;
}

export function createUniqueId(prefix?: string): string {
  const randomValue =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}-${randomValue}` : randomValue;
}
