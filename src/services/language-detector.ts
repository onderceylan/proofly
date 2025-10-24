import { logger } from "./logger.ts";

export interface ILanguageDetector {
  detect(text: string): Promise<LanguageDetectionResult[]>;
  destroy(): void;
}

export interface LanguageDetectorServiceConfig {
  minTextLength: number;
  confidenceThreshold: number;
}

export const DEFAULT_LANGUAGE_DETECTOR_CONFIG: LanguageDetectorServiceConfig = {
  minTextLength: 10,
  confidenceThreshold: 0.5,
};

export async function checkLanguageDetectorAvailability(): Promise<Availability> {
  if (!('LanguageDetector' in window)) {
    logger.warn('Chrome Built-in Language Detection API not available');
    return 'unavailable';
  }

  const availability = await LanguageDetector.availability();
  return availability;
}

export async function createLanguageDetector(
  onProgress?: (progress: number) => void
): Promise<LanguageDetector> {
  const availability = await checkLanguageDetectorAvailability();

  if (availability === 'unavailable') {
    throw new Error('Language Detection API not supported on this device');
  }

  const detector = await LanguageDetector.create({
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        logger.info(`Language detector downloaded ${e.loaded * 100}%`);
        onProgress?.(e.loaded);
      });
    },
  });

  return detector;
}

export function createLanguageDetectorAdapter(detector: LanguageDetector): ILanguageDetector {
  return {
    async detect(text: string): Promise<LanguageDetectionResult[]> {
      return detector.detect(text);
    },
    destroy(): void {
      detector.destroy();
    },
  };
}

/**
 * Create language detection service with dependency injection
 *
 * This service provides a clean API for detecting language with:
 * - Text length validation
 * - Confidence threshold filtering
 * - Empty text handling
 *
 * @example
 * ```typescript
 * const detector = await createLanguageDetector();
 * const adapter = createLanguageDetectorAdapter(detector);
 * const service = createLanguageDetectionService(adapter);
 *
 * const result = await service.detectLanguage('Hello world');
 * console.log(result); // "en"
 * ```
 */
export function createLanguageDetectionService(
  detector: ILanguageDetector,
  config: LanguageDetectorServiceConfig = DEFAULT_LANGUAGE_DETECTOR_CONFIG
) {
  return {
    /**
     * Detect the language of the text and return the most confident result
     * Returns null if no confident language is detected
     */
    async detectLanguage(text: string): Promise<string | null> {
      const trimmed = text.trim();

      // Validate text length
      if (trimmed.length === 0 || trimmed.length < config.minTextLength) {
        return null;
      }

      const results = await detector.detect(text);

      // Filter results by confidence threshold and return the top result
      const topResult = results
        .filter(result => result.confidence !== undefined && result.confidence >= config.confidenceThreshold)
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];

      if (!topResult || !topResult.detectedLanguage) {
        logger.warn(`No confident language detected for text (${results.length} results)`);
        return null;
      }

      logger.info(`Detected language: ${topResult.detectedLanguage} (confidence: ${(topResult.confidence ?? 0).toFixed(2)})`);
      return topResult.detectedLanguage;
    },

    /**
     * Detect all possible languages with their confidence scores
     */
    async detectAllLanguages(text: string): Promise<LanguageDetectionResult[]> {
      const trimmed = text.trim();

      if (trimmed.length === 0 || trimmed.length < config.minTextLength) {
        return [];
      }

      return detector.detect(text);
    },

    /**
     * Check if text is valid for language detection
     */
    canDetect(text: string): boolean {
      const trimmed = text.trim();
      return trimmed.length >= config.minTextLength;
    },

    /**
     * Get current configuration
     */
    getConfig(): LanguageDetectorServiceConfig {
      return { ...config };
    },

    /**
     * Clean up resources
     */
    destroy(): void {
      detector.destroy();
    },
  };
}

/**
 * Singleton pattern for managing a single language detector instance
 * Useful for background scripts or service workers
 */
let languageDetectorInstance: LanguageDetector | null = null;

export async function getOrCreateLanguageDetector(
  onProgress?: (progress: number) => void
): Promise<LanguageDetector> {
  if (!languageDetectorInstance) {
    languageDetectorInstance = await createLanguageDetector(onProgress);
  }
  return languageDetectorInstance;
}

export function destroyLanguageDetectorInstance(): void {
  if (languageDetectorInstance) {
    languageDetectorInstance.destroy();
    languageDetectorInstance = null;
  }
}
