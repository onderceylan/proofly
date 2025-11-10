import { logger } from '../services/logger.ts';

export interface IProofreader {
  proofread(text: string): Promise<ProofreadResult>;
  destroy(): void;
}

export interface ProofreaderConfig {
  expectedInputLanguages: string[];
  includeCorrectionTypes: boolean;
  includeCorrectionExplanations: boolean;
  correctionExplanationLanguage?: string;
}

export interface ProofreaderServiceConfig {
  retryAttempts: number;
  timeoutMs: number;
  minTextLength: number;
  maxTextLength: number;
}

export interface ProofreadingServiceHooks {
  onBusyChange?(busy: boolean): void;
}

export const DEFAULT_PROOFREADER_CONFIG: ProofreaderConfig = {
  expectedInputLanguages: ['en'],
  includeCorrectionTypes: true,
  includeCorrectionExplanations: true,
  correctionExplanationLanguage: 'en',
};

export const DEFAULT_SERVICE_CONFIG: ProofreaderServiceConfig = {
  retryAttempts: 3,
  timeoutMs: 30000,
  minTextLength: 1,
  maxTextLength: 10000,
};

export async function checkProofreaderAvailability(): Promise<Availability> {
  if (!('Proofreader' in globalThis)) {
    logger.warn('Chrome Built-in Proofreader API not available');
    return 'unavailable';
  }

  const availability = await Proofreader.availability({
    expectedInputLanguages: DEFAULT_PROOFREADER_CONFIG.expectedInputLanguages,
  });

  return availability;
}

export async function createProofreader(
  config: ProofreaderConfig = DEFAULT_PROOFREADER_CONFIG,
  onProgress?: (progress: number) => void
): Promise<Proofreader> {
  const availability = await checkProofreaderAvailability();

  if (availability === 'unavailable') {
    throw new Error('Proofreader API not supported on this device');
  }

  const proofreader = await Proofreader.create({
    expectedInputLanguages: config.expectedInputLanguages,
    includeCorrectionTypes: config.includeCorrectionTypes,
    includeCorrectionExplanations: config.includeCorrectionExplanations,
    correctionExplanationLanguage: config.correctionExplanationLanguage,
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        logger.info(`Downloaded ${e.loaded * 100}%`);
        onProgress?.(e.loaded);
      });
    },
  });

  return proofreader;
}

export function createProofreaderAdapter(proofreader: Proofreader): IProofreader {
  return {
    async proofread(text: string): Promise<ProofreadResult> {
      return proofreader.proofread(text);
    },
    destroy(): void {
      proofreader.destroy();
    },
  };
}

/**
 * Create proofreading service with dependency injection
 *
 * This service provides a clean API for proofreading text with:
 * - Text length validation
 * - Empty text handling
 * - Retry logic (via external utility)
 * - Timeout handling (via external utility)
 *
 * @example
 * ```typescript
 * const proofreader = await createProofreader();
 * const adapter = createProofreaderAdapter(proofreader);
 * const service = createProofreadingService(adapter);
 *
 * const result = await service.proofread('I seen him yesterday');
 * console.log(result.correctedInput); // "I saw him yesterday"
 * ```
 */
export function createProofreadingService(
  proofreader: IProofreader,
  config: ProofreaderServiceConfig = DEFAULT_SERVICE_CONFIG,
  hooks?: ProofreadingServiceHooks
) {
  return {
    /**
     * Proofread text and return corrections
     * Returns empty corrections array for empty or invalid text
     */
    async proofread(text: string): Promise<ProofreadResult> {
      const trimmed = text.trim();

      // Validate text length
      if (trimmed.length === 0) {
        return { correctedInput: text, corrections: [] };
      }

      if (trimmed.length < config.minTextLength) {
        return { correctedInput: text, corrections: [] };
      }

      if (trimmed.length > config.maxTextLength) {
        throw new Error(
          `Text length (${trimmed.length}) exceeds maximum (${config.maxTextLength})`
        );
      }

      hooks?.onBusyChange?.(true);
      try {
        return await proofreader.proofread(text);
      } finally {
        hooks?.onBusyChange?.(false);
      }
    },

    /**
     * Check if text is valid for proofreading
     */
    canProofread(text: string): boolean {
      const trimmed = text.trim();
      return trimmed.length >= config.minTextLength && trimmed.length <= config.maxTextLength;
    },

    /**
     * Get current configuration
     */
    getConfig(): ProofreaderServiceConfig {
      return { ...config };
    },

    /**
     * Clean up resources
     */
    destroy(): void {
      proofreader.destroy();
    },
  };
}

/**
 * Singleton pattern for managing a single proofreader instance
 * Useful for background scripts or service workers
 */
let proofreaderInstance: Proofreader | null = null;

export async function getOrCreateProofreader(
  config?: ProofreaderConfig,
  onProgress?: (progress: number) => void
): Promise<Proofreader> {
  if (!proofreaderInstance) {
    proofreaderInstance = await createProofreader(config, onProgress);
  }
  return proofreaderInstance;
}

export function destroyProofreaderInstance(): void {
  if (proofreaderInstance) {
    proofreaderInstance.destroy();
    proofreaderInstance = null;
  }
}
