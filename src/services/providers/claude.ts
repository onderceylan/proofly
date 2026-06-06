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

const ANTHROPIC_API_VERSION = '2023-06-01';

const PROOFREAD_TOOL = {
  name: 'report_corrections',
  description:
    'Report all proofreading corrections found in the text. Each correction must reference the exact original text from the input.',
  input_schema: {
    type: 'object' as const,
    properties: {
      corrections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            originalText: {
              type: 'string',
              description: 'The exact original substring from the input that contains the error',
            },
            correctedText: {
              type: 'string',
              description: 'The corrected replacement text',
            },
            type: {
              type: 'string',
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
              type: 'string',
              description: 'Brief explanation of the correction',
            },
          },
          required: ['originalText', 'correctedText'],
        },
      },
    },
    required: ['corrections'],
  },
};

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_API_VERSION,
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  return headers;
}

export const claudeProvider: ApiProvider = {
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
    const models = (data.data ?? []) as Array<{ id: string; display_name?: string }>;
    return models.map((m) => ({
      id: m.id,
      displayName: m.display_name ?? m.id,
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

        const response = await fetchWithTimeout(`${base}/v1/messages`, {
          method: 'POST',
          headers: buildHeaders(apiKey),
          body: JSON.stringify({
            model: selectedModel,
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: buildUserPrompt(text) }],
            tools: [PROOFREAD_TOOL],
            tool_choice: { type: 'any' },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(parseErrorBody(response, errorData));
        }

        const data = await response.json();

        const toolUse = (
          data.content as Array<{ type: string; name?: string; input?: unknown }>
        )?.find((block) => block.type === 'tool_use' && block.name === 'report_corrections');

        if (!toolUse) {
          return { correctedInput: text, corrections: [] };
        }

        const rawCorrections: RawCorrection[] =
          (toolUse.input as { corrections?: RawCorrection[] })?.corrections ?? [];

        return buildProofreadResult(text, rawCorrections, 'Claude');
      },

      destroy() {},
    };
  },
};
