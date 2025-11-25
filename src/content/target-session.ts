import { createMirror, type Mirror } from './mirror.ts';
import { ShadowOverlay } from './shadow-overlay.ts';
import { UnderlineRenderer, type UnderlineDescriptor, type IssueType } from './renderer.ts';
import { createRafScheduler } from './sync.ts';
import { computeLineHeight, debounce, getBoxMetrics, type PaddingBox } from './utils.ts';
import {
  buildCorrectionColorThemes,
  type CorrectionColorThemeMap,
} from '../shared/utils/correction-types.ts';
import type { UnderlineStyle } from '../shared/types.ts';

export type Issue = {
  id: string;
  start: number;
  end: number;
  type: IssueType;
  label: string;
};

export type IssueColorPalette = CorrectionColorThemeMap;

interface Hooks {
  onNeedProofread?: (value: string) => void;
  onUnderlineClick?: (issueId: string, pageRect: DOMRect, anchorNode: HTMLElement) => void;
  onUnderlineDoubleClick?: (issueId: string, issue: Issue) => void;
  onInvalidateIssues?: () => void;
}

interface TargetMetrics {
  padding: PaddingBox;
  lineHeight: number;
}

const VIRTUALIZATION_MARGIN = 200;
const PROOFREAD_DEBOUNCE_MS = 400;
const DEFAULT_COLOR_PALETTE = buildCorrectionColorThemes();

export class TargetSession {
  private readonly overlay: ShadowOverlay;
  private readonly mirror: Mirror;
  private readonly renderer: UnderlineRenderer;
  private readonly hooks: Hooks;
  private readonly raf = createRafScheduler(() => this.flushFrame());
  private readonly debouncedNeedProofread: (value: string) => void;

  private attached = false;
  private overlayMounted = false;
  private needsLayout = false;
  private needsValue = false;
  private needsRender = false;
  private needsMeasurement = false;

  private metrics: TargetMetrics | null = null;
  private containerRect: DOMRect = new DOMRect();
  private measuredDescriptors: UnderlineDescriptor[] = [];
  private issues: Issue[] = [];
  private colorPalette: IssueColorPalette = DEFAULT_COLOR_PALETTE;
  private activeIssueId: string | null = null;
  private previewIssueId: string | null = null;
  private underlineStyle: UnderlineStyle = 'solid';
  private autofixOnDoubleClick: boolean = false;

  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;

  private readonly handleInput = () => {
    this.hooks.onInvalidateIssues?.();
    this.needsValue = true;
    this.needsRender = true;
    this.needsMeasurement = true;
    this.raf.schedule();
    this.debouncedNeedProofread(this.getTargetValue());
  };

  private readonly handleScroll = () => {
    this.overlay.updateScroll(this.target.scrollLeft, this.target.scrollTop);
    this.needsRender = true;
    this.raf.schedule();
  };

  private readonly handleWindowScroll = () => {
    this.needsLayout = true;
    this.needsRender = true;
    this.raf.schedule();
  };

  private readonly handleWindowResize = () => {
    this.needsLayout = true;
    this.needsRender = true;
    this.needsMeasurement = true;
    this.raf.schedule();
  };

  private readonly handleOverlayWheel = (event: WheelEvent) => {
    if (event.defaultPrevented) {
      return;
    }
    if (!event.deltaX && !event.deltaY) {
      return;
    }
    const { scrollLeft, scrollTop } = this.target;
    this.target.scrollBy({ left: event.deltaX, top: event.deltaY });
    const scrolled = this.target.scrollLeft !== scrollLeft || this.target.scrollTop !== scrollTop;
    if (scrolled) {
      event.preventDefault();
    }
  };

  private readonly handleUnderlineClick = (event: MouseEvent) => {
    // If autofix is enabled, prevent popover on single click
    if (this.autofixOnDoubleClick) {
      return;
    }

    if (!this.hooks.onUnderlineClick) {
      return;
    }
    const node = event.target as HTMLElement | null;
    if (!node || !node.classList.contains('u')) {
      return;
    }
    this.activateIssueFromNode(node);
  };

  private readonly handleUnderlineDoubleClick = (event: MouseEvent) => {
    // Only process double-click if autofix is enabled
    if (!this.autofixOnDoubleClick) {
      return;
    }

    if (!this.hooks.onUnderlineDoubleClick) {
      return;
    }

    const node = event.target as HTMLElement | null;
    if (!node || !node.classList.contains('u')) {
      return;
    }
    const issueId = node.dataset.issueId;
    if (!issueId) {
      return;
    }

    const issue = this.issues.find((i) => i.id === issueId);
    if (!issue) {
      return;
    }

    this.hooks.onUnderlineDoubleClick(issueId, issue);
  };

  private readonly handleUnderlinePointerDown = (event: PointerEvent) => {
    const node = event.target as HTMLElement | null;
    if (!node || !node.classList.contains('u')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.target.focus({ preventScroll: true });
  };

  private readonly handleUnderlineKeyDown = (event: KeyboardEvent) => {
    if (this.autofixOnDoubleClick) {
      return;
    }

    const node = event.target as HTMLElement | null;
    if (!node || !node.classList.contains('u')) {
      return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.activateIssueFromNode(node);
  };

  private activateIssueFromNode(node: HTMLElement): void {
    if (!this.hooks.onUnderlineClick) {
      return;
    }

    const issueId = node.dataset.issueId;
    if (!issueId) {
      return;
    }
    const rect = node.getBoundingClientRect();
    const rectHeightCorrection = 10;
    const pageRect = new DOMRect(
      rect.left,
      rect.top + rectHeightCorrection,
      rect.width,
      rect.height
    );
    this.setActiveIssue(issueId);
    this.hooks.onUnderlineClick(issueId, pageRect, node);
  }

  constructor(
    private readonly target: HTMLTextAreaElement | HTMLInputElement,
    hooks?: Hooks
  ) {
    this.overlay = new ShadowOverlay(target);
    this.mirror = createMirror(target);
    this.renderer = new UnderlineRenderer(this.overlay.elements.underlines);
    this.hooks = hooks ?? {};
    this.overlay.elements.container.insertBefore(
      this.mirror.element,
      this.overlay.elements.underlines
    );
    this.debouncedNeedProofread = debounce((value: string) => {
      this.hooks.onNeedProofread?.(value);
    }, PROOFREAD_DEBOUNCE_MS);
  }

  attach(): void {
    if (this.attached) {
      return;
    }

    const { underlines } = this.overlay.elements;

    this.target.addEventListener('input', this.handleInput);
    this.target.addEventListener('scroll', this.handleScroll, {
      passive: true,
    });
    underlines.addEventListener('pointerdown', this.handleUnderlinePointerDown, {
      capture: true,
    });
    underlines.addEventListener('click', this.handleUnderlineClick);
    underlines.addEventListener('dblclick', this.handleUnderlineDoubleClick);
    underlines.addEventListener('wheel', this.handleOverlayWheel, {
      passive: false,
    });
    underlines.addEventListener('keydown', this.handleUnderlineKeyDown);
    window.addEventListener('scroll', this.handleWindowScroll, true);
    window.addEventListener('resize', this.handleWindowResize);

    this.resizeObserver = new ResizeObserver(() => {
      this.needsLayout = true;
      this.needsRender = true;
      this.needsMeasurement = true;
      this.raf.schedule();
    });
    this.resizeObserver.observe(this.target);

    this.mutationObserver = new MutationObserver(() => {
      this.needsLayout = true;
      this.needsRender = true;
      this.needsMeasurement = true;
      this.raf.schedule();
    });
    this.mutationObserver.observe(this.target, {
      attributes: true,
      attributeFilter: ['class', 'style', 'dir'],
    });

    this.needsLayout = true;
    this.needsValue = true;
    this.needsRender = true;
    this.needsMeasurement = true;
    this.raf.schedule();

    this.attached = true;
  }

  detach(): void {
    if (!this.attached) {
      return;
    }
    this.raf.cancel();
    this.activeIssueId = null;
    this.overlay.elements.underlines.removeEventListener(
      'pointerdown',
      this.handleUnderlinePointerDown,
      {
        capture: true,
      }
    );
    this.overlay.elements.underlines.removeEventListener('click', this.handleUnderlineClick);
    this.overlay.elements.underlines.removeEventListener(
      'dblclick',
      this.handleUnderlineDoubleClick
    );
    this.overlay.elements.underlines.removeEventListener('wheel', this.handleOverlayWheel);
    this.overlay.elements.underlines.removeEventListener('keydown', this.handleUnderlineKeyDown);
    this.target.removeEventListener('input', this.handleInput);
    this.target.removeEventListener('scroll', this.handleScroll);
    window.removeEventListener('scroll', this.handleWindowScroll, true);
    window.removeEventListener('resize', this.handleWindowResize);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.resizeObserver = null;
    this.mutationObserver = null;
    this.detachOverlay();
    this.attached = false;
  }

  setIssues(issues: Issue[]): void {
    this.issues = issues;
    if (this.activeIssueId && !issues.some((issue) => issue.id === this.activeIssueId)) {
      this.activeIssueId = null;
    }
    if (this.previewIssueId && !issues.some((issue) => issue.id === this.previewIssueId)) {
      this.previewIssueId = null;
    }
    if (issues.length > 0) {
      this.ensureOverlayMounted();
    } else {
      this.detachOverlay();
    }
    this.needsMeasurement = true;
    this.needsRender = true;
    this.raf.schedule();
  }

  setColorPalette(palette: IssueColorPalette): void {
    this.colorPalette = palette;
    if (this.attached) {
      this.needsRender = true;
      this.raf.schedule();
    }
  }

  setUnderlineStyle(style: UnderlineStyle): void {
    if (this.underlineStyle === style) {
      return;
    }
    this.underlineStyle = style;
    if (this.attached) {
      this.needsRender = true;
      this.raf.schedule();
    }
  }

  setAutofixOnDoubleClick(enabled: boolean): void {
    this.autofixOnDoubleClick = enabled;
  }

  clearActiveIssue(): void {
    this.setActiveIssue(null);
  }

  setPreviewIssue(issueId: string | null): void {
    if (this.previewIssueId === issueId) {
      return;
    }
    this.previewIssueId = issueId;
    this.needsRender = true;
    this.raf.schedule();
  }

  clearPreviewIssue(): void {
    this.setPreviewIssue(null);
  }

  private flushFrame(): void {
    if (!this.attached) {
      return;
    }

    if (!this.overlayMounted) {
      return;
    }

    if (this.needsLayout) {
      this.syncLayout();
      this.needsLayout = false;
    }

    if (this.needsValue) {
      this.syncValue();
      this.needsValue = false;
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

  private ensureOverlayMounted(): void {
    if (this.overlayMounted) {
      return;
    }
    this.overlay.attach();
    this.overlayMounted = true;
    this.needsLayout = true;
    this.needsValue = true;
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

  private syncLayout(): void {
    this.overlay.updateLayout();
    this.overlay.updateScroll(this.target.scrollLeft, this.target.scrollTop);
    this.mirror.updateStylesFrom(this.target);
    const metrics = getBoxMetrics(this.target);
    this.metrics = {
      padding: metrics.padding,
      lineHeight: computeLineHeight(this.target),
    };
    this.mirror.setWidth(Math.max(this.target.scrollWidth, this.target.clientWidth));
    this.containerRect = this.overlay.getContainerClientRect();
  }

  private syncValue(): void {
    this.mirror.setValue(this.getTargetValue());
    this.mirror.setWidth(Math.max(this.target.scrollWidth, this.target.clientWidth));
  }

  private measureIssues(): void {
    if (!this.metrics) {
      return;
    }

    const containerRect = this.overlay.getContainerClientRect();
    // Store a copy because DOMRect from getBoundingClientRect() is live in Chromium.
    this.containerRect = new DOMRect(
      containerRect.left,
      containerRect.top,
      containerRect.width,
      containerRect.height
    );

    const descriptors: UnderlineDescriptor[] = [];

    for (const issue of this.issues) {
      if (issue.end <= issue.start) {
        continue;
      }

      // The proofreader API uses UTF-16 code unit indices. Mirror text is kept in sync with the
      // textarea value, which also exposes UTF-16 indices, so we can map them directly.
      const rects = this.mirror.getRects(issue.start, issue.end);

      let index = 0;
      for (const rect of rects) {
        if (!rect || rect.width === 0 || rect.height === 0) {
          index += 1;
          continue;
        }
        const overlayRect = new DOMRect(
          rect.left - this.containerRect.left,
          rect.top - this.containerRect.top,
          rect.width,
          rect.height
        );
        descriptors.push({
          key: `${issue.id}:${index}`,
          issueId: issue.id,
          type: issue.type,
          rectIndex: index,
          rect: overlayRect,
          label: issue.label,
        });
        index += 1;
      }
    }

    this.measuredDescriptors = descriptors;
  }

  private render(): void {
    if (!this.metrics) {
      return;
    }

    this.renderer.render(this.measuredDescriptors, {
      paddingLeft: this.metrics.padding.left,
      paddingRight: this.metrics.padding.right,
      paddingTop: this.metrics.padding.top,
      paddingBottom: this.metrics.padding.bottom,
      scrollLeft: this.target.scrollLeft,
      scrollTop: this.target.scrollTop,
      clientWidth: this.target.clientWidth,
      clientHeight: this.target.clientHeight,
      lineHeight: this.metrics.lineHeight,
      margin: VIRTUALIZATION_MARGIN,
      activeIssueId: this.activeIssueId,
      previewIssueId: this.previewIssueId,
      palette: this.colorPalette,
      underlineStyle: this.underlineStyle,
    });
  }

  private getTargetValue(): string {
    return this.target.value;
  }

  private setActiveIssue(issueId: string | null): void {
    if (this.activeIssueId === issueId) {
      return;
    }
    this.activeIssueId = issueId;
    this.needsRender = true;
    this.raf.schedule();
  }
}
