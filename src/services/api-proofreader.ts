import type { ApiType } from '../shared/types.ts';
import type { ApiProvider } from './providers/api-provider-utils.ts';
import { claudeProvider } from './providers/claude.ts';
import { geminiProvider } from './providers/gemini.ts';
import { openaiCompatibleProvider } from './providers/openai-compatible.ts';

export type { ApiTestResult, ApiModel, ApiProvider } from './providers/api-provider-utils.ts';

const providers = new Map<ApiType, ApiProvider>([
  ['claude', claudeProvider],
  ['gemini', geminiProvider],
  ['openai-compatible', openaiCompatibleProvider],
]);

export function getApiProvider(type: ApiType): ApiProvider {
  const provider = providers.get(type);
  if (!provider) {
    throw new Error(`Unsupported API provider: ${type}`);
  }
  return provider;
}

export async function requestHostPermission(apiUrl: string): Promise<boolean> {
  try {
    const origin = new URL(apiUrl).origin + '/*';
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return true;
    return chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}
