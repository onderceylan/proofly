import type { ProofreadCorrection, UnderlineStyle } from '../../shared/types.ts';
import type { IssueColorPalette } from '../target-session.ts';

export interface TargetHandler {
  readonly element: HTMLElement;
  attach(): void;
  detach(): void;
  highlight(corrections: ProofreadCorrection[]): void;
  clearHighlights(): void;
  clearSelection(): void;
  updatePreferences(prefs: {
    colorPalette?: IssueColorPalette;
    underlineStyle?: UnderlineStyle;
    autofixOnDoubleClick?: boolean;
  }): void;
  dispose(): void;
}
