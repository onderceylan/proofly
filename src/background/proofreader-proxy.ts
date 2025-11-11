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

let proofreaderService: ReturnType<typeof createProofreadingService> | null = null;
let initializationPromise: Promise<ReturnType<typeof createProofreadingService>> | null = null;
let activeOperations = 0;

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

async function initializeProofreaderService(): Promise<
  ReturnType<typeof createProofreadingService>
> {
  logger.info('Initializing Proofreader service worker instance');
  const proofreader = await createProofreader({
    includeCorrectionTypes: true,
    includeCorrectionExplanations: true,
    correctionExplanationLanguage: 'en',
  });
  const adapter = createProofreaderAdapter(proofreader);
  const service = createProofreadingService(adapter);
  proofreaderService = service;
  return service;
}

async function getOrCreateProofreaderService(): Promise<
  ReturnType<typeof createProofreadingService>
> {
  if (proofreaderService) {
    return proofreaderService;
  }

  if (!initializationPromise) {
    initializationPromise = initializeProofreaderService().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }

  try {
    return await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

export async function handleProofreadRequest(
  message: ProofreadRequestMessage
): Promise<ProofreadResponse> {
  const { requestId, text } = message.payload;

  activeOperations += 1;
  try {
    const service = await getOrCreateProofreaderService();
    logger.info(
      {
        requestId,
        textLength: text.length,
      },
      'Proofreader service will initiate proofread request'
    );
    const result = await service.proofread(text);
    logger.info(
      {
        requestId,
        result: result,
      },
      'Proofreader service completed request'
    );
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
      { error: serializeError(error), requestId },
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
  proofreaderService?.destroy();
  proofreaderService = null;
  initializationPromise = null;
}

export function isProofreaderProxyBusy(): boolean {
  return activeOperations > 0;
}
