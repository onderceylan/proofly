import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from './logger.ts';
import {
  DEFAULT_LANGUAGE_DETECTOR_CONFIG,
  ILanguageDetector,
  checkLanguageDetectorAvailability,
  createLanguageDetector,
  createLanguageDetectorAdapter,
  createLanguageDetectionService,
  destroyLanguageDetectorInstance,
  getOrCreateLanguageDetector,
} from './language-detector.ts';

const globalRef = globalThis as Record<string, unknown>;

function setupWindow() {
  globalRef.window = globalRef.window ?? (globalThis as Window & typeof globalThis);
}

function mockLanguageDetector(availability: Availability = 'available') {
  const instance = {
    detect: vi.fn().mockResolvedValue([{ detectedLanguage: 'en', confidence: 0.9 }]),
    destroy: vi.fn(),
  };

  const availabilityMock = vi.fn().mockResolvedValue(availability);
  const createMock = vi
    .fn()
    .mockImplementation(async (options?: { monitor?: (monitor: any) => void }) => {
      options?.monitor?.({
        addEventListener: (_event: string, handler: (data: { loaded: number }) => void) => {
          handler({ loaded: 0.5 });
        },
      });
      return instance as unknown as LanguageDetector;
    });

  globalRef.LanguageDetector = {
    availability: availabilityMock,
    create: createMock,
  };

  return { instance, availabilityMock, createMock };
}

describe('language detector service', () => {
  beforeEach(() => {
    setupWindow();
    vi.clearAllMocks();
    delete globalRef.LanguageDetector;
    destroyLanguageDetectorInstance();
  });

  it('returns unavailable and warns when API is missing', async () => {
    const result = await checkLanguageDetectorAvailability();
    expect(result).toBe('unavailable');
    expect(logger.warn).toHaveBeenCalledWith(
      'Chrome Built-in Language Detection API not available'
    );
  });

  it('checks availability via Chrome API when available', async () => {
    const { availabilityMock } = mockLanguageDetector('downloadable');
    const result = await checkLanguageDetectorAvailability();
    expect(result).toBe('downloadable');
    expect(availabilityMock).toHaveBeenCalledTimes(1);
  });

  it('throws during creation when availability is unavailable', async () => {
    mockLanguageDetector('unavailable');
    await expect(createLanguageDetector()).rejects.toThrow(
      'Language Detection API not supported on this device'
    );
  });

  it('notifies progress while creating detector', async () => {
    mockLanguageDetector('downloadable');
    const onProgress = vi.fn();
    await createLanguageDetector(onProgress);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(logger.info).toHaveBeenCalledWith('Language detector downloaded 50%');
  });

  it('adapts detector interface', async () => {
    const { instance } = mockLanguageDetector('downloadable');
    const detector = await createLanguageDetector();
    const adapter = createLanguageDetectorAdapter(detector);

    await adapter.detect('text');
    adapter.destroy();

    expect(instance.detect).toHaveBeenCalledWith('text');
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('detects language with confidence filtering', async () => {
    const detector: ILanguageDetector = {
      detect: vi.fn().mockResolvedValue([
        { detectedLanguage: 'en', confidence: 0.7 },
        { detectedLanguage: 'fr', confidence: 0.6 },
      ]),
      destroy: vi.fn(),
    };
    const service = createLanguageDetectionService(detector);
    const result = await service.detectLanguage('Hello world sample text');
    expect(result).toBe('en');
    expect(logger.info).toHaveBeenCalledWith('Detected language: en (confidence: 0.70)');
  });

  it('returns null and warns when no confident language exists', async () => {
    const detector: ILanguageDetector = {
      detect: vi.fn().mockResolvedValue([{ detectedLanguage: 'en', confidence: 0.2 }]),
      destroy: vi.fn(),
    };
    const service = createLanguageDetectionService(detector, {
      ...DEFAULT_LANGUAGE_DETECTOR_CONFIG,
      confidenceThreshold: 0.8,
    });
    const result = await service.detectLanguage('Hello world sample text');
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('No confident language detected for text (1 results)');
  });

  it('returns [] for detectAllLanguages when text too short', async () => {
    const detector: ILanguageDetector = {
      detect: vi.fn(),
      destroy: vi.fn(),
    };
    const service = createLanguageDetectionService(detector);
    const result = await service.detectAllLanguages('short');
    expect(result).toEqual([]);
    expect(detector.detect).not.toHaveBeenCalled();
  });

  it('exposes utility helpers', async () => {
    const detector: ILanguageDetector = {
      detect: vi.fn().mockResolvedValue([]),
      destroy: vi.fn(),
    };
    const service = createLanguageDetectionService(detector, {
      minTextLength: 5,
      confidenceThreshold: 0.5,
    });

    expect(service.canDetect('text')).toBe(false);
    expect(service.canDetect('longer text')).toBe(true);
    expect(service.getConfig()).toEqual({ minTextLength: 5, confidenceThreshold: 0.5 });

    service.destroy();
    expect(detector.destroy).toHaveBeenCalledTimes(1);
  });

  it('caches detector instances via singleton helpers', async () => {
    mockLanguageDetector('downloadable');
    const first = await getOrCreateLanguageDetector();
    const second = await getOrCreateLanguageDetector();
    expect(first).toBe(second);

    destroyLanguageDetectorInstance();
    mockLanguageDetector('downloadable');
    const fresh = await getOrCreateLanguageDetector();
    expect(fresh).not.toBe(first);
  });
});
