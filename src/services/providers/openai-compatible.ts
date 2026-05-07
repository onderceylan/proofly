import type { IProofreader } from '../proofreader.ts';
import type { ProofreadResult, ApiConfig } from '../../shared/types.ts';
import type { ApiProvider, ApiModel, RawCorrection } from './api-provider-utils.ts';
import {
  fetchWithTimeout,
  ensureHostPermission,
  parseErrorBody,
  testConnectionWith,
  buildProofreadResult,
  normalizeBaseUrl,
} from './api-provider-utils.ts';
import { logger } from '../logger.ts';

const JSON_SYSTEM_PROMPT = `You are a precise proofreading assistant. Detect the language of the input text automatically and identify grammar, spelling, punctuation, capitalization, preposition, and missing-word errors. Only report real errors — not style preferences.

Rules:
- NEVER correct proper nouns, brand names, product names, or technical terms.
- originalText must be the EXACT substring from the input containing the error.
- correctedText must be a SINGLE direct replacement — never multiple alternatives.
- The replacement must be directly substitutable: replacing originalText with correctedText in the input must produce valid text.

Respond ONLY with a JSON object in this exact format, no other text:
{"corrections":[{"originalText":"exact error text","correctedText":"single fixed text","type":"spelling|grammar|punctuation|capitalization|preposition|missing-words","explanation":"brief reason"}]}

If there are no errors, respond with: {"corrections":[]}`;

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (apiKey) {
    headers['authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  const braces = text.match(/\{[\s\S]*\}/);
  if (braces) return braces[0];

  return null;
}

function tryParseJson(json: string): unknown | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function repairJson(json: string): string {
  return json
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
    .replace(/:\s*'([^']*)'/g, ':"$1"')
    .replace(/"\s*\n\s*"/g, '","');
}

function parseCorrections(content: string): RawCorrection[] {
  const json = extractJson(content);
  if (!json) {
    logger.warn({ content }, 'OpenAI-compatible: no JSON found in response');
    return [];
  }

  let parsed = tryParseJson(json);
  if (!parsed) {
    parsed = tryParseJson(repairJson(json));
  }
  if (!parsed) {
    logger.warn({ json }, 'OpenAI-compatible: failed to parse JSON from response');
    return [];
  }

  const corrections = (parsed as { corrections?: unknown }).corrections;
  return Array.isArray(corrections) ? (corrections as RawCorrection[]) : [];
}

export const openaiCompatibleProvider: ApiProvider = {
  async testConnection(config: ApiConfig) {
    const base = normalizeBaseUrl(config.apiUrl);
    return testConnectionWith(
      () => fetchWithTimeout(`${base}/v1/models`, { headers: buildHeaders(config.apiKey) }),
      parseErrorBody
    );
  },

  async fetchModels(config: ApiConfig): Promise<ApiModel[]> {
    const base = normalizeBaseUrl(config.apiUrl);

    const response = await fetchWithTimeout(`${base}/v1/models`, {
      headers: buildHeaders(config.apiKey),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(parseErrorBody(response, errorData));
    }

    const data = await response.json();
    const models = (data.data ?? []) as Array<{ id: string; name?: string }>;
    return models.map((m) => ({
      id: m.id,
      displayName: m.name ?? m.id,
    }));
  },

  createProofreader(config: ApiConfig): IProofreader {
    return {
      async proofread(text: string): Promise<ProofreadResult> {
        const { apiKey, selectedModel } = config;
        const base = normalizeBaseUrl(config.apiUrl);

        if (!selectedModel) {
          throw new Error('No AI model selected. Please choose a model in settings.');
        }

        await ensureHostPermission(config.apiUrl);

        const response = await fetchWithTimeout(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(apiKey),
          body: JSON.stringify({
            model: selectedModel,
            messages: [
              {
                role: 'user',
                content: `${JSON_SYSTEM_PROMPT}\n\nProofread the following text and report all errors:\n\n${text}`,
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(parseErrorBody(response, errorData));
        }

        const data = await response.json();
        const content = (data.choices?.[0]?.message?.content as string) ?? '';

        if (!content) {
          return { correctedInput: text, corrections: [] };
        }

        const rawCorrections = parseCorrections(content);
        return buildProofreadResult(text, rawCorrections, 'OpenAI-compatible');
      },

      destroy() {},
    };
  },
};
