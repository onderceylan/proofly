import { logger } from '../services/logger.ts';
import {
  createProofreader,
  createProofreaderAdapter,
  createProofreadingService,
} from '../services/proofreader.ts';
import type {
  ProofreadRequestMessage,
  ProofreadResponse,
  ProofreadServiceErrorCode,
} from '../shared/messages/issues.ts';
import { serializeError } from '../shared/utils/serialize.ts';

const DEFAULT_FALLBACK_LANGUAGE = 'en';

const proofreaderServices = new Map<string, ReturnType<typeof createProofreadingService>>();
let activeOperations = 0;

const getLanguageCacheKey = (language: string): string =>
  language.trim().toLowerCase() || DEFAULT_FALLBACK_LANGUAGE;

const normalizeLanguage = (language: string, fallback: string): string => {
  const trimmed = language.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const isUnsupportedLanguageError = (error: unknown): boolean => {
  if (!error) {
    return false;
  }
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : typeof error === 'string'
        ? error.toLowerCase()
        : '';
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return message.includes('language');
  }
  return message.includes('language options') || message.includes('unsupported language');
};

async function getOrCreateProofreaderServiceForLanguage(
  language: string,
  fallbackLanguage: string
): Promise<ReturnType<typeof createProofreadingService>> {
  const cacheKey = getLanguageCacheKey(language);
  const cached = proofreaderServices.get(cacheKey);
  if (cached) {
    return cached;
  }

  logger.info(
    { language, fallbackLanguage },
    'Initializing Proofreader service worker instance for language'
  );
  const proofreader = await createProofreader({
    expectedInputLanguages: [language],
    includeCorrectionTypes: true,
    includeCorrectionExplanations: true,
    correctionExplanationLanguage: fallbackLanguage,
  });
  const adapter = createProofreaderAdapter(proofreader);
  const service = createProofreadingService(adapter);
  proofreaderServices.set(cacheKey, service);
  return service;
}

export async function handleProofreadRequest(
  message: ProofreadRequestMessage
): Promise<ProofreadResponse> {
  const { requestId, text, language, fallbackLanguage } = message.payload;
  const normalizedFallback = fallbackLanguage || DEFAULT_FALLBACK_LANGUAGE;
  const requestedLanguage = normalizeLanguage(language, normalizedFallback);

  activeOperations += 1;
  try {
    const service = await getOrCreateProofreaderServiceForLanguage(
      requestedLanguage,
      normalizedFallback
    );
    const result = await service.proofread(text);
    return { requestId, ok: true, result };
  } catch (error) {
    const messageText =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Proofreader request failed';
    const isCancelled =
      (error instanceof DOMException && error.name === 'AbortError') ||
      /cancelled/i.test(messageText);
    const errorCode: ProofreadServiceErrorCode = isCancelled
      ? 'cancelled'
      : isUnsupportedLanguageError(error)
        ? 'unsupported-language'
        : 'unknown';
    logger.warn(
      { error: serializeError(error), language: requestedLanguage, requestId },
      'Proofreader API call failed in service worker'
    );

    return {
      requestId,
      ok: false,
      error: {
        code: errorCode,
        message: messageText,
        name: error instanceof Error ? error.name : undefined,
      },
    };
  } finally {
    activeOperations = Math.max(0, activeOperations - 1);
  }
}

export function resetProofreaderServices(): void {
  if (isProofreaderProxyBusy()) {
    logger.info(
      { activeOperations },
      'Deferring proofreader proxy reset because operations are still running'
    );
    return;
  }
  proofreaderServices.forEach((service) => service.destroy());
  proofreaderServices.clear();
}

export function isProofreaderProxyBusy(): boolean {
  return activeOperations > 0;
}
