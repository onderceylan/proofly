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
  SYSTEM_PROMPT,
  buildUserPrompt,
} from './api-provider-utils.ts';

interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface GeminiPart {
  functionCall?: GeminiFunctionCall;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
}

const GEMINI_PROOFREAD_TOOL = {
  function_declarations: [
    {
      name: 'report_corrections',
      description:
        'Report all proofreading corrections found in the text. Each correction must reference the exact original text from the input.',
      parameters: {
        type: 'OBJECT',
        properties: {
          corrections: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                originalText: {
                  type: 'STRING',
                  description:
                    'The exact original substring from the input that contains the error',
                },
                correctedText: {
                  type: 'STRING',
                  description: 'The corrected replacement text',
                },
                type: {
                  type: 'STRING',
                  enum: [
                    'spelling',
                    'grammar',
                    'punctuation',
                    'capitalization',
                    'preposition',
                    'missing-words',
                  ],
                  description: 'The error category',
                },
                explanation: {
                  type: 'STRING',
                  description: 'Brief explanation of the correction',
                },
              },
              required: ['originalText', 'correctedText'],
            },
          },
        },
        required: ['corrections'],
      },
    },
  ],
};

function buildUrl(apiUrl: string, path: string, apiKey: string): string {
  const url = new URL(path, normalizeBaseUrl(apiUrl));
  if (apiKey) url.searchParams.set('key', apiKey);
  return url.toString();
}

export const geminiProvider: ApiProvider = {
  async testConnection(config: ApiConfig) {
    const { apiUrl, apiKey } = config;
    return testConnectionWith(
      () =>
        fetchWithTimeout(buildUrl(apiUrl, '/v1beta/models', apiKey), {
          headers: { 'content-type': 'application/json' },
        }),
      parseErrorBody
    );
  },

  async fetchModels(config: ApiConfig): Promise<ApiModel[]> {
    const { apiUrl, apiKey } = config;

    const url = buildUrl(apiUrl, '/v1beta/models?pageSize=1000', apiKey);
    const response = await fetchWithTimeout(url, {
      headers: { 'content-type': 'application/json' },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(parseErrorBody(response, errorData));
    }

    const data = await response.json();
    const models = (data.models ?? []) as Array<{
      name: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
    return models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({
        id: m.name.replace(/^models\//, ''),
        displayName: m.displayName ?? m.name,
      }));
  },

  createProofreader(config: ApiConfig): IProofreader {
    return {
      async proofread(text: string): Promise<ProofreadResult> {
        const { apiUrl, apiKey, selectedModel } = config;

        if (!selectedModel) {
          throw new Error('No AI model selected. Please choose a model in settings.');
        }

        await ensureHostPermission(apiUrl);

        const url = buildUrl(apiUrl, `/v1beta/models/${selectedModel}:generateContent`, apiKey);
        const response = await fetchWithTimeout(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts: [{ text: buildUserPrompt(text) }] }],
            tools: [GEMINI_PROOFREAD_TOOL],
            toolConfig: { functionCallingConfig: { mode: 'ANY' } },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(parseErrorBody(response, errorData));
        }

        const data = await response.json();
        const parts = (data as GeminiResponse)?.candidates?.[0]?.content?.parts;
        const fnCall = parts?.find((p) => p.functionCall?.name === 'report_corrections');

        if (!fnCall?.functionCall) {
          return { correctedInput: text, corrections: [] };
        }

        const rawCorrections =
          (fnCall.functionCall.args as { corrections?: RawCorrection[] })?.corrections ?? [];

        return buildProofreadResult(text, rawCorrections, 'Gemini');
      },

      destroy() {},
    };
  },
};
