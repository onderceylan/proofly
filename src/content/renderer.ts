import type {
  CorrectionColorThemeMap,
  CorrectionTypeKey,
} from '../shared/utils/correction-types.ts';
import type { UnderlineStyle } from '../shared/types.ts';

export type IssueType = CorrectionTypeKey;

export interface UnderlineDescriptor {
  key: string;
  issueId: string;
  type: IssueType;
  rectIndex: number;
  rect: DOMRect;
  label: string;
}

export interface RenderOptions {
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  scrollLeft: number;
  scrollTop: number;
  clientWidth: number;
  clientHeight: number;
  lineHeight: number;
  margin: number;
  activeIssueId?: string | null;
  previewIssueId?: string | null;
  palette: CorrectionColorThemeMap;
  underlineStyle: UnderlineStyle;
}

export class UnderlineRenderer {
  private readonly elements = new Map<string, HTMLDivElement>();

  constructor(private readonly container: HTMLElement) {}

  render(descriptors: UnderlineDescriptor[], options: RenderOptions): void {
    const footprint = new Set<string>();
    const baseUnderlineHeight = Math.max(2, Math.round(options.lineHeight * 0.08));
    const underlineHeight =
      options.underlineStyle === 'wavy' ? Math.max(baseUnderlineHeight, 4) : baseUnderlineHeight;
    const radius = 4;

    const visibleWidth = Math.max(
      0,
      options.clientWidth - options.paddingLeft - options.paddingRight
    );
    const visibleHeight = Math.max(
      0,
      options.clientHeight - options.paddingTop - options.paddingBottom
    );

    const horizontalStart = options.scrollLeft - options.margin;
    const horizontalEnd = options.scrollLeft + visibleWidth + options.margin;
    const verticalStart = options.scrollTop - options.margin;
    const verticalEnd = options.scrollTop + visibleHeight + options.margin;

    for (const descriptor of descriptors) {
      const { rect } = descriptor;
      const contentLeft = rect.left - options.paddingLeft;
      const contentTop = rect.top - options.paddingTop;
      const contentRight = contentLeft + rect.width;
      const contentBottom = contentTop + rect.height;

      if (contentRight < horizontalStart || contentLeft > horizontalEnd) {
        continue;
      }
      if (contentBottom < verticalStart || contentTop > verticalEnd) {
        continue;
      }

      footprint.add(descriptor.key);
      const element = this.getOrCreate(descriptor);
      const paletteEntry = options.palette[descriptor.type] ?? options.palette.spelling;

      element.style.left = `${rect.left}px`;
      element.style.top = `${rect.top}px`;
      element.style.width = `${Math.max(rect.width, 0)}px`;
      element.style.height = `${Math.max(rect.height, underlineHeight)}px`;
      element.style.borderRadius = `${radius}px`;
      element.style.setProperty('--underline-height', `${underlineHeight}px`);
      element.style.setProperty('--underline-offset', '0');
      element.style.cursor = 'text';
      element.style.color = paletteEntry.color;
      element.style.setProperty('--fill-color', paletteEntry.background);
      element.dataset.underlineStyle = options.underlineStyle;
      element.dataset.type = descriptor.type;
      const isActive = descriptor.issueId === options.activeIssueId;
      const isPreview = descriptor.issueId === options.previewIssueId;
      if (isActive) {
        element.dataset.active = 'true';
      } else {
        delete element.dataset.active;
      }
      if (isPreview) {
        element.dataset.preview = 'true';
      } else {
        delete element.dataset.preview;
      }
      element.setAttribute('role', 'button');
      element.tabIndex = 0;
      element.setAttribute('aria-label', descriptor.label);
      element.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }

    for (const [key, element] of this.elements) {
      if (!footprint.has(key)) {
        element.remove();
        this.elements.delete(key);
      }
    }
  }

  clear(): void {
    for (const element of this.elements.values()) {
      element.remove();
    }
    this.elements.clear();
  }

  private getOrCreate(descriptor: UnderlineDescriptor): HTMLDivElement {
    const existing = this.elements.get(descriptor.key);
    if (existing) {
      return existing;
    }
    const node = document.createElement('div');
    node.className = 'u';
    node.dataset.issueId = descriptor.issueId;
    node.dataset.type = descriptor.type;
    node.dataset.rectIndex = String(descriptor.rectIndex);
    this.container.appendChild(node);
    this.elements.set(descriptor.key, node);
    return node;
  }
}
