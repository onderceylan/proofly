import type { CorrectionPopover } from '../components/correction-popover.ts';
import type { ContentHighlighter } from '../components/content-highlighter.ts';
import type { ProofreadCorrection } from '../../shared/types.ts';

export interface PopoverManagerOptions {
  highlighter: ContentHighlighter;
  onCorrectionApplied: (element: HTMLElement, correction: ProofreadCorrection) => void;
  onPopoverHide: () => void;
}

export class PopoverManager {
  private popover: CorrectionPopover | null = null;
  private popoverHideCleanup: (() => void) | null = null;
  private autofixOnDoubleClick = false;

  constructor(private readonly options: PopoverManagerOptions) {}

  setAutofixOnDoubleClick(enabled: boolean): void {
    this.autofixOnDoubleClick = enabled;
    this.updateVisibility();
  }

  updateVisibility(hasCorrections = false): void {
    if (this.autofixOnDoubleClick || !hasCorrections) {
      this.detachPopover();
      return;
    }

    this.ensurePopover();
  }

  show(
    element: HTMLElement,
    correction: ProofreadCorrection,
    issueText: string,
    x: number,
    y: number,
    positionResolver?: () => { x: number; y: number } | null
  ): void {
    if (!this.popover) {
      this.updateVisibility(true);
    }
    if (!this.popover) {
      return;
    }

    this.popover.setCorrection(correction, issueText, (applied) => {
      this.options.onCorrectionApplied(element, applied);
    });

    this.popover.show(x, y, { anchorElement: element, positionResolver });
  }

  hide(): void {
    this.popover?.hide();
  }

  destroy(): void {
    this.detachPopover();
  }

  private ensurePopover(): void {
    if (this.popover) {
      return;
    }

    let popover = document.querySelector('proofly-correction-popover') as CorrectionPopover | null;
    if (!popover) {
      popover = document.createElement('proofly-correction-popover') as CorrectionPopover;
      document.body.appendChild(popover);
    }

    this.popover = popover;
    this.options.highlighter.setPopover(this.popover);

    this.cleanupHandler(this.popoverHideCleanup);
    if (!this.popover) {
      return;
    }

    const handlePopoverHide = () => {
      this.options.onPopoverHide();
    };
    this.popover.addEventListener('proofly:popover-hide', handlePopoverHide);
    this.popoverHideCleanup = () => {
      this.popover?.removeEventListener('proofly:popover-hide', handlePopoverHide);
    };
  }

  private detachPopover(): void {
    if (!this.popover) {
      return;
    }

    this.options.highlighter.setPopover(null);
    this.cleanupHandler(this.popoverHideCleanup);
    this.popoverHideCleanup = null;
    this.popover.remove();
    this.popover = null;
  }

  private cleanupHandler(cleanup: (() => void) | null): void {
    cleanup?.();
  }
}
