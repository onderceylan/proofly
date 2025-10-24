export type UnderlineStyle = 'solid' | 'wavy' | 'dotted';

export type CorrectionType =
  | 'spelling'
  | 'grammar'
  | 'punctuation'
  | 'capitalization'
  | 'preposition'
  | 'missing-words';

export interface ProofreadCorrection {
  startIndex: number;
  endIndex: number;
  correction: string;
  type?: CorrectionType;
  explanation?: string;
}

export interface ProofreadResult {
  correctedInput: string;
  corrections: ProofreadCorrection[];
}
