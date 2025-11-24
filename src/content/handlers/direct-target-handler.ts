import type { TargetHandler } from './target-handler.ts';
import type { ContentHighlighter } from '../components/content-highlighter.ts';
import type { ProofreadCorrection, UnderlineStyle } from '../../shared/types.ts';
import type { IssueColorPalette } from '../target-session.ts';

interface DirectTargetHandlerOptions {
  highlighter: ContentHighlighter;
  onCorrectionApplied: (corrections: ProofreadCorrection[]) => void;
  onApplyCorrection: (correction: ProofreadCorrection) => void;
}

export class DirectTargetHandler implements TargetHandler {
  constructor(
    public readonly element: HTMLElement,
    private readonly options: DirectTargetHandlerOptions
  ) {}

  attach(): void {
    this.options.highlighter.setApplyCorrectionCallback(this.element, (_target, correction) => {
      this.options.onApplyCorrection(correction);
    });

    this.options.highlighter.setOnCorrectionApplied(this.element, (updatedCorrections) => {
      this.options.onCorrectionApplied(updatedCorrections);
    });
  }

  detach(): void {
    // ContentHighlighter doesn't have a specific detach for callbacks per element exposed easily
    // but clearHighlights cleans up some state.
    // The manager's destroy/cleanup logic handles global cleanup.
    // For per-element cleanup, we might want to add methods to ContentHighlighter if needed,
    // but currently it manages its own maps.
    this.options.highlighter.clearHighlights(this.element);
  }

  highlight(corrections: ProofreadCorrection[]): void {
    this.options.highlighter.highlight(this.element, corrections);
  }

  clearHighlights(): void {
    this.options.highlighter.clearHighlights(this.element);
  }

  clearSelection(): void {
    this.options.highlighter.clearSelection();
  }

  updatePreferences(_prefs: {
    colorPalette?: IssueColorPalette;
    underlineStyle?: UnderlineStyle;
    autofixOnDoubleClick?: boolean;
  }): void {
    // ContentHighlighter manages these globally for now.
    // If we needed per-element preferences for direct highlighting, we'd pass them here.
    // But ContentHighlighter is a singleton-like service in the manager.
  }

  dispose(): void {
    this.detach();
  }
}
