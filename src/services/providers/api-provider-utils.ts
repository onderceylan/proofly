import type { IProofreader } from '../proofreader.ts';
import type {
  ProofreadCorrection,
  ProofreadResult,
  CorrectionType,
  ApiConfig,
} from '../../shared/types.ts';
import { logger } from '../logger.ts';

export interface ApiTestResult {
  ok: boolean;
  message: string;
}

export interface ApiModel {
  id: string;
  displayName: string;
}

export interface ApiProvider {
  testConnection(config: ApiConfig): Promise<ApiTestResult>;
  fetchModels(config: ApiConfig): Promise<ApiModel[]>;
  createProofreader(config: ApiConfig): IProofreader;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export const SYSTEM_PROMPT =
  'You are a precise proofreading assistant. Detect the language of the input text automatically and identify grammar, spelling, punctuation, capitalization, preposition, and missing-word errors. Use the provided tool to report corrections. Only report real errors — not style preferences.';

export function buildUserPrompt(text: string): string {
  return `Proofread the following text and report all errors:\n\n${text}`;
}

export interface RawCorrection {
  originalText: string;
  correctedText: string;
  type?: string;
  explanation?: string;
}

export function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function ensureHostPermission(apiUrl: string): Promise<void> {
  const origin = new URL(apiUrl).origin + '/*';
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) {
    throw new Error(
      `Permission not granted for ${new URL(apiUrl).origin}. Please test the connection in Settings first.`
    );
  }
}

export function parseErrorBody(response: Response, errorData: unknown): string {
  return (
    (errorData as { error?: { message?: string } })?.error?.message ??
    `HTTP ${response.status}: ${response.statusText}`
  );
}

export function resolvePositions(
  text: string,
  rawCorrections: RawCorrection[]
): ProofreadCorrection[] {
  const corrections: ProofreadCorrection[] = [];
  const usedRanges: Array<[number, number]> = [];

  for (const raw of rawCorrections) {
    const { originalText, correctedText, type, explanation } = raw;
    if (!originalText || originalText === correctedText) continue;

    let searchFrom = 0;
    let idx = -1;
    while ((idx = text.indexOf(originalText, searchFrom)) !== -1) {
      const end = idx + originalText.length;
      const overlaps = usedRanges.some(([s, e]) => idx < e && end > s);
      if (!overlaps) break;
      searchFrom = idx + 1;
    }
    if (idx === -1) continue;

    usedRanges.push([idx, idx + originalText.length]);
    corrections.push({
      startIndex: idx,
      endIndex: idx + originalText.length,
      correction: correctedText,
      type: type as CorrectionType | undefined,
      explanation,
    });
  }

  corrections.sort((a, b) => a.startIndex - b.startIndex);
  const filtered: ProofreadCorrection[] = [];
  let lastEnd = -1;
  for (const c of corrections) {
    if (c.startIndex >= lastEnd) {
      filtered.push(c);
      lastEnd = c.endIndex;
    }
  }

  return filtered;
}

export function buildProofreadResult(
  text: string,
  rawCorrections: RawCorrection[],
  providerName: string
): ProofreadResult {
  const corrections = resolvePositions(text, rawCorrections);

  let correctedInput = text;
  const sorted = [...corrections].sort((a, b) => b.startIndex - a.startIndex);
  for (const correction of sorted) {
    correctedInput =
      correctedInput.slice(0, correction.startIndex) +
      correction.correction +
      correctedInput.slice(correction.endIndex);
  }

  logger.info({ corrections: corrections.length }, `${providerName} API proofreading completed`);

  return { correctedInput, corrections };
}

export async function testConnectionWith(
  fetchFn: () => Promise<Response>,
  parseError: (res: Response, data: unknown) => string
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetchFn();

    if (response.ok) {
      return { ok: true, message: 'Connection successful' };
    }

    const errorData = await response.json().catch(() => ({}));
    return { ok: false, message: parseError(response, errorData) };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, message: 'Connection timed out' };
    }
    const msg = error instanceof Error ? error.message : 'Connection failed';
    return { ok: false, message: msg };
  }
}
