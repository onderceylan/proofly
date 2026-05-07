import type { TargetHandler } from './target-handler.ts';
import type { ProofreadCorrection, UnderlineStyle } from '../../shared/types.ts';
import type { IssueColorPalette } from '../target-session.ts';
import { UnderlineRenderer, type UnderlineDescriptor, type IssueType } from '../renderer.ts';
import { createRafScheduler } from '../sync.ts';
import {
  getCorrectionTypeColor,
  type CorrectionTypeKey,
} from '../../shared/utils/correction-types.ts';
import {
  extractContentEditableText,
  resolveContentEditableOffset,
} from '../../shared/utils/contenteditable-text.ts';
import { debounce } from '../../shared/utils/debounce.ts';

const PROOFREAD_DEBOUNCE_MS = 800;

interface ContentEditableHandlerOptions {
  onUnderlineClick: (issueId: string, pageRect: DOMRect, anchorNode: HTMLElement) => void;
  onUnderlineDoubleClick: (issueId: string) => void;
  onInvalidateIssues: () => void;
  onNeedProofread?: () => void;
  initialPalette: IssueColorPalette;
  initialUnderlineStyle: UnderlineStyle;
  initialAutofixOnDoubleClick: boolean;
}

interface Issue {
  id: string;
  start: number;
  end: number;
  type: IssueType;
  label: string;
}

export class ContentEditableTargetHandler implements TargetHandler {
  private readonly overlay: ContentEditableOverlay;
  private readonly renderer: UnderlineRenderer;
  private readonly raf = createRafScheduler(() => this.flushFrame());

  private attached = false;
  private overlayMounted = false;
  private needsLayout = false;
  private needsRender = false;
  private needsMeasurement = false;

  private issues: Issue[] = [];
  private colorPalette: IssueColorPalette;
  private underlineStyle: UnderlineStyle;
  private autofixOnDoubleClick: boolean;
  private activeIssueId: string | null = null;
  private previewIssueId: string | null = null;
  private measuredDescriptors: UnderlineDescriptor[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private scrollParent: Element | null = null;
  private readonly debouncedNeedProofread: () => void;

  constructor(
    public readonly element: HTMLElement,
    private readonly options: ContentEditableHandlerOptions
  ) {
    this.overlay = new ContentEditableOverlay(element);
    this.renderer = new UnderlineRenderer(this.overlay.underlines);
    this.colorPalette = options.initialPalette;
    this.underlineStyle = options.initialUnderlineStyle;
    this.autofixOnDoubleClick = options.initialAutofixOnDoubleClick;
    this.debouncedNeedProofread = debounce(() => {
      this.options.onNeedProofread?.();
    }, PROOFREAD_DEBOUNCE_MS);
  }

  attach(): void {
    if (this.attached) {
      return;
    }

    const { underlines } = this.overlay;

    this.element.addEventListener('input', this.handleInput);
    underlines.addEventListener('pointerdown', this.handlePointerDown, { capture: true });
    underlines.addEventListener('click', this.handleClick);
    underlines.addEventListener('dblclick', this.handleDoubleClick);
    window.addEventListener('scroll', this.handleWindowScroll, true);
    window.addEventListener('resize', this.handleWindowResize);

    this.scrollParent = findScrollParent(this.element);
    if (this.scrollParent) {
      this.scrollParent.addEventListener('scroll', this.handleParentScroll, { passive: true });
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.needsLayout = true;
      this.needsMeasurement = true;
      this.needsRender = true;
      this.raf.schedule();
    });
    this.resizeObserver.observe(this.element);

    this.attached = true;
  }

  detach(): void {
    if (!this.attached) {
      return;
    }

    this.raf.cancel();
    this.element.removeEventListener('input', this.handleInput);

    const { underlines } = this.overlay;
    underlines.removeEventListener('pointerdown', this.handlePointerDown, { capture: true });
    underlines.removeEventListener('click', this.handleClick);
    underlines.removeEventListener('dblclick', this.handleDoubleClick);

    window.removeEventListener('scroll', this.handleWindowScroll, true);
    window.removeEventListener('resize', this.handleWindowResize);

    if (this.scrollParent) {
      this.scrollParent.removeEventListener('scroll', this.handleParentScroll);
      this.scrollParent = null;
    }

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.detachOverlay();
    this.attached = false;
  }

  highlight(corrections: ProofreadCorrection[]): void {
    const elementText = extractContentEditableText(this.element);
    this.issues = mapCorrectionsToIssues(corrections, elementText);

    if (this.issues.length > 0) {
      this.ensureOverlayMounted();
    } else {
      this.detachOverlay();
    }

    this.needsMeasurement = true;
    this.needsRender = true;
    this.raf.schedule();
  }

  clearHighlights(): void {
    this.issues = [];
    this.activeIssueId = null;
    this.previewIssueId = null;
    this.detachOverlay();
  }

  clearSelection(): void {
    this.activeIssueId = null;
    this.previewIssueId = null;
    this.needsRender = true;
    this.raf.schedule();
  }

  previewIssue(issueId: string | null): void {
    if (this.previewIssueId === issueId) {
      return;
    }
    this.previewIssueId = issueId;
    this.needsRender = true;
    this.raf.schedule();
  }

  updatePreferences(prefs: {
    colorPalette?: IssueColorPalette;
    underlineStyle?: UnderlineStyle;
    autofixOnDoubleClick?: boolean;
  }): void {
    if (prefs.colorPalette) {
      this.colorPalette = prefs.colorPalette;
    }
    if (prefs.underlineStyle) {
      this.underlineStyle = prefs.underlineStyle;
    }
    if (prefs.autofixOnDoubleClick !== undefined) {
      this.autofixOnDoubleClick = prefs.autofixOnDoubleClick;
    }
    if (this.attached) {
      this.needsRender = true;
      this.raf.schedule();
    }
  }

  dispose(): void {
    this.detach();
    this.overlay.destroy();
  }

  private readonly handleInput = () => {
    this.options.onInvalidateIssues();
    if (this.issues.length > 0) {
      this.needsMeasurement = true;
      this.needsRender = true;
      this.raf.schedule();
    }
    this.debouncedNeedProofread();
  };

  private readonly handleWindowScroll = () => {
    this.needsLayout = true;
    this.needsMeasurement = true;
    this.needsRender = true;
    this.raf.schedule();
  };

  private readonly handleWindowResize = () => {
    this.needsLayout = true;
    this.needsMeasurement = true;
    this.needsRender = true;
    this.raf.schedule();
  };

  private readonly handleParentScroll = () => {
    this.needsLayout = true;
    this.needsMeasurement = true;
    this.needsRender = true;
    this.raf.schedule();
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    const node = event.target as HTMLElement | null;
    if (!node || !node.classList.contains('u')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.element.focus({ preventScroll: true });
  };

  private readonly handleClick = (event: MouseEvent) => {
    if (this.autofixOnDoubleClick) {
      return;
    }
    const node = event.target as HTMLElement | null;
    if (!node || !node.classList.contains('u')) {
      return;
    }
    this.activateIssueFromNode(node);
  };

  private readonly handleDoubleClick = (event: MouseEvent) => {
    if (!this.autofixOnDoubleClick) {
      return;
    }
    const node = event.target as HTMLElement | null;
    if (!node || !node.classList.contains('u')) {
      return;
    }
    const issueId = node.dataset.issueId;
    if (issueId) {
      this.options.onUnderlineDoubleClick(issueId);
    }
  };

  private activateIssueFromNode(node: HTMLElement): void {
    const issueId = node.dataset.issueId;
    if (!issueId) {
      return;
    }
    const rect = node.getBoundingClientRect();
    const pageRect = new DOMRect(rect.left, rect.top + 10, rect.width, rect.height);
    this.activeIssueId = issueId;
    this.needsRender = true;
    this.raf.schedule();
    this.options.onUnderlineClick(issueId, pageRect, node);
  }

  private ensureOverlayMounted(): void {
    if (this.overlayMounted) {
      return;
    }
    this.overlay.attach();
    this.overlayMounted = true;
    this.needsLayout = true;
    this.needsMeasurement = true;
    this.needsRender = true;
    this.raf.schedule();
  }

  private detachOverlay(): void {
    if (!this.overlayMounted) {
      return;
    }
    this.renderer.clear();
    this.overlay.detach();
    this.overlayMounted = false;
  }

  private flushFrame(): void {
    if (!this.attached || !this.overlayMounted) {
      return;
    }

    if (this.needsLayout) {
      this.overlay.syncPosition();
      this.needsLayout = false;
    }

    if (this.needsMeasurement) {
      this.measureIssues();
      this.needsMeasurement = false;
      this.needsRender = true;
    }

    if (this.needsRender) {
      this.render();
      this.needsRender = false;
    }
  }

  private measureIssues(): void {
    const fieldRect = this.element.getBoundingClientRect();
    const descriptors: UnderlineDescriptor[] = [];

    for (const issue of this.issues) {
      if (issue.end <= issue.start) {
        continue;
      }

      const rects = getContentEditableRects(this.element, issue.start, issue.end);
      let index = 0;

      for (const rect of rects) {
        if (rect.width === 0 || rect.height === 0) {
          index++;
          continue;
        }
        descriptors.push({
          key: `${issue.id}:${index}`,
          issueId: issue.id,
          type: issue.type,
          rectIndex: index,
          rect: new DOMRect(
            rect.left - fieldRect.left,
            rect.top - fieldRect.top,
            rect.width,
            rect.height
          ),
          label: issue.label,
        });
        index++;
      }
    }

    this.measuredDescriptors = descriptors;
  }

  private render(): void {
    const computed = getComputedStyle(this.element);
    const lineHeight = parseFloat(computed.lineHeight) || parseFloat(computed.fontSize) * 1.2;

    this.renderer.render(this.measuredDescriptors, {
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      paddingBottom: 0,
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: this.element.clientWidth,
      clientHeight: this.element.clientHeight,
      lineHeight,
      margin: 200,
      activeIssueId: this.activeIssueId,
      previewIssueId: this.previewIssueId,
      palette: this.colorPalette,
      underlineStyle: this.underlineStyle,
    });
  }
}

class ContentEditableOverlay {
  private readonly host: HTMLElement;
  private readonly shadow: ShadowRoot;
  readonly underlines: HTMLDivElement;
  private mounted = false;

  constructor(private readonly field: HTMLElement) {
    this.host = document.createElement('prfly-ce-overlay');
    this.host.setAttribute('role', 'presentation');
    Object.assign(this.host.style, {
      position: 'fixed',
      pointerEvents: 'none',
      overflow: 'hidden',
      zIndex: String(computeZIndex(field)),
    });

    this.shadow = this.host.attachShadow({ mode: 'open' });

    const waveMask = `url("data:image/svg+xml;utf8,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 4" preserveAspectRatio="none">' +
        '<path d="M0 2 Q3 0 6 2 T12 2" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />' +
        '</svg>'
    )}")`;

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; contain: layout paint style; }
      #underlines {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .u {
        position: absolute;
        pointer-events: auto;
        border-radius: 4px;
        color: rgba(220, 38, 38, 0.9);
        --fill-color: rgba(220, 38, 38, 0.16);
      }
      .u::before, .u::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
      }
      .u::before {
        top: 0; bottom: 0;
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
      .u[data-active="true"]::before,
      .u[data-preview="true"]::before { opacity: 1; }
      .u[data-underline-style="solid"]::after {
        -webkit-mask-image: none;
        mask-image: none;
      }
      .u[data-underline-style="dotted"]::after {
        border-bottom: currentColor dotted 2px;
        background: none;
      }
      .u[data-underline-style="wavy"]::after {
        mask-image: ${waveMask};
        mask-size: 12px 6px;
        mask-repeat: repeat-x;
        mask-position: left calc(100% + 1px);
      }
    `;

    this.underlines = document.createElement('div');
    this.underlines.id = 'underlines';
    this.shadow.append(style, this.underlines);
  }

  attach(): void {
    if (this.mounted) {
      return;
    }
    const container = this.getContainer();
    container?.appendChild(this.host);
    this.mounted = true;
    this.syncPosition();
  }

  detach(): void {
    if (!this.mounted) {
      return;
    }
    this.host.remove();
    this.mounted = false;
  }

  syncPosition(): void {
    const rect = this.field.getBoundingClientRect();
    Object.assign(this.host.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  destroy(): void {
    this.detach();
  }

  private getContainer(): HTMLElement | null {
    const dialog = this.field.closest('dialog') as HTMLDialogElement | null;
    if (dialog && dialog.open) {
      return dialog;
    }
    return this.field.ownerDocument?.body ?? document.body;
  }
}

function getContentEditableRects(
  field: HTMLElement,
  startIndex: number,
  endIndex: number
): DOMRect[] {
  const start = resolveContentEditableOffset(field, startIndex);
  const end = resolveContentEditableOffset(field, endIndex);

  if (!start || !end) {
    return [];
  }

  try {
    const range = document.createRange();
    range.setStart(start.node, Math.max(0, start.offset));
    range.setEnd(end.node, Math.min(end.node.length, end.offset));
    return Array.from(range.getClientRects());
  } catch {
    return [];
  }
}

function findScrollParent(el: Element): Element | null {
  let parent = el.parentElement;
  while (parent) {
    const { overflow, overflowY } = getComputedStyle(parent);
    if (/auto|scroll/.test(overflow + overflowY)) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

function computeZIndex(target: HTMLElement): number {
  const value = Number.parseInt(getComputedStyle(target).zIndex ?? '', 10);
  return Number.isFinite(value) ? value + 1 : 1;
}

function mapCorrectionsToIssues(corrections: ProofreadCorrection[], elementText: string): Issue[] {
  return corrections
    .filter((c) => c.endIndex > c.startIndex)
    .map((correction, index) => ({
      id: `${correction.startIndex}:${correction.endIndex}:${index}`,
      start: correction.startIndex,
      end: correction.endIndex,
      type: ((correction.type as CorrectionTypeKey) || 'spelling') as IssueType,
      label: buildIssueLabel(correction, elementText),
    }));
}

function buildIssueLabel(correction: ProofreadCorrection, elementText: string): string {
  const paletteEntry = getCorrectionTypeColor(correction.type);
  const suggestion = correction.correction;

  if (typeof suggestion === 'string') {
    if (suggestion === ' ') {
      return `${paletteEntry.label} suggestion: space character`;
    }
    if (suggestion === '') {
      return `${paletteEntry.label} suggestion: remove highlighted text`;
    }
    if (suggestion.trim().length > 0) {
      return `${paletteEntry.label} suggestion: ${suggestion.trim()}`;
    }
    return `${paletteEntry.label} suggestion: whitespace adjustment`;
  }

  const maxLen = elementText.length;
  const safeStart = Math.max(0, Math.min(correction.startIndex, maxLen));
  const safeEnd = Math.max(safeStart, Math.min(correction.endIndex, maxLen));
  const original = elementText.slice(safeStart, safeEnd).trim();
  if (original.length > 0) {
    return `${paletteEntry.label} issue: ${original}`;
  }

  return `${paletteEntry.label} suggestion`;
}
