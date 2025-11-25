import type { TargetHandler } from './target-handler.ts';
import {
  TargetSession,
  type Issue as SessionIssue,
  type IssueColorPalette,
} from '../target-session.ts';
import type { ProofreadCorrection, UnderlineStyle } from '../../shared/types.ts';
import {
  getCorrectionTypeColor,
  type CorrectionTypeKey,
} from '../../shared/utils/correction-types.ts';

interface MirrorTargetHandlerOptions {
  onNeedProofread: () => void;
  onUnderlineClick: (issueId: string, pageRect: DOMRect, anchorNode: HTMLElement) => void;
  onUnderlineDoubleClick: (issueId: string) => void;
  onInvalidateIssues: () => void;
  initialPalette: IssueColorPalette;
  initialUnderlineStyle: UnderlineStyle;
  initialAutofixOnDoubleClick: boolean;
}

export class MirrorTargetHandler implements TargetHandler {
  private readonly session: TargetSession;

  constructor(
    public readonly element: HTMLTextAreaElement | HTMLInputElement,
    options: MirrorTargetHandlerOptions
  ) {
    this.session = new TargetSession(element, {
      onNeedProofread: options.onNeedProofread,
      onUnderlineClick: options.onUnderlineClick,
      onUnderlineDoubleClick: (issueId) => {
        options.onUnderlineDoubleClick(issueId);
      },
      onInvalidateIssues: options.onInvalidateIssues,
    });

    this.session.setColorPalette(options.initialPalette);
    this.session.setUnderlineStyle(options.initialUnderlineStyle);
    this.session.setAutofixOnDoubleClick(options.initialAutofixOnDoubleClick);
  }

  attach(): void {
    this.session.attach();
  }

  detach(): void {
    this.session.detach();
  }

  highlight(corrections: ProofreadCorrection[]): void {
    const issues = this.mapCorrectionsToIssues(corrections, this.element.value ?? '');
    this.session.setIssues(issues);
  }

  clearHighlights(): void {
    this.session.setIssues([]);
    this.session.clearActiveIssue();
    this.session.clearPreviewIssue();
  }

  clearSelection(): void {
    this.session.clearActiveIssue();
    this.session.clearPreviewIssue();
  }

  updatePreferences(prefs: {
    colorPalette?: IssueColorPalette;
    underlineStyle?: UnderlineStyle;
    autofixOnDoubleClick?: boolean;
  }): void {
    if (prefs.colorPalette) {
      this.session.setColorPalette(prefs.colorPalette);
    }
    if (prefs.underlineStyle) {
      this.session.setUnderlineStyle(prefs.underlineStyle);
    }
    if (prefs.autofixOnDoubleClick !== undefined) {
      this.session.setAutofixOnDoubleClick(prefs.autofixOnDoubleClick);
    }
  }

  dispose(): void {
    this.detach();
  }

  previewIssue(issueId: string | null): void {
    this.session.setPreviewIssue(issueId);
  }

  private mapCorrectionsToIssues(
    corrections: ProofreadCorrection[],
    elementText: string
  ): SessionIssue[] {
    const validCorrections = corrections.filter(
      (correction) => correction.endIndex > correction.startIndex
    );
    return validCorrections.map((correction, index) => ({
      id: this.buildIssueId(correction, index),
      start: correction.startIndex,
      end: correction.endIndex,
      type: this.toIssueType(correction),
      label: this.buildIssueLabel(correction, elementText),
    }));
  }

  private buildIssueId(correction: ProofreadCorrection, index: number): string {
    return `${correction.startIndex}:${correction.endIndex}:${index}`;
  }

  private toIssueType(correction: ProofreadCorrection): SessionIssue['type'] {
    return (correction.type as CorrectionTypeKey) || 'spelling';
  }

  private buildIssueLabel(correction: ProofreadCorrection, elementText: string): string {
    const paletteEntry = getCorrectionTypeColor(correction.type);
    const suggestionValue = correction.correction;

    if (typeof suggestionValue === 'string') {
      if (suggestionValue === ' ') {
        return `${paletteEntry.label} suggestion: space character`;
      }
      if (suggestionValue === '') {
        return `${paletteEntry.label} suggestion: remove highlighted text`;
      }
      if (suggestionValue.trim().length > 0) {
        return `${paletteEntry.label} suggestion: ${suggestionValue.trim()}`;
      }
      return `${paletteEntry.label} suggestion: whitespace adjustment`;
    }

    if (elementText && elementText.length > 0) {
      const originalText = this.extractOriginalText(elementText, correction).trim();
      if (originalText.length > 0) {
        return `${paletteEntry.label} issue: ${originalText}`;
      }
    }

    return `${paletteEntry.label} suggestion`;
  }

  private extractOriginalText(text: string, correction: ProofreadCorrection): string {
    if (!text) {
      return '';
    }
    const maxIndex = text.length;
    const safeStart = Math.max(0, Math.min(correction.startIndex, maxIndex));
    const safeEnd = Math.max(safeStart, Math.min(correction.endIndex, maxIndex));
    return text.slice(safeStart, safeEnd);
  }
}
