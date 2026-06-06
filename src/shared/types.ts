export type UnderlineStyle = 'solid' | 'wavy' | 'dotted';

export type ModelSource = 'local' | 'api';

export type ApiType = 'claude' | 'gemini' | 'openai-compatible';

export interface ApiConfig {
  type: ApiType;
  apiUrl: string;
  apiKey: string;
  selectedModel: string;
  selectedModelDisplayName: string;
}

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
