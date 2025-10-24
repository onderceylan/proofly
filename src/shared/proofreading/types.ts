import type { ProofreadCorrection } from '../../shared/types.ts';

export interface ProofreadingTargetHooks {
  highlight(corrections: ProofreadCorrection[]): void;
  clearHighlights(): void;
  onCorrectionsChange?(corrections: ProofreadCorrection[]): void;
}

export interface ProofreadingTarget {
  element: HTMLElement;
  hooks: ProofreadingTargetHooks;
}
