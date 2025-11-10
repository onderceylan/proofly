import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger.ts';
import {
  type DownloadProgress,
  MODEL_SIZE_BYTES,
  createModelDownloader,
  formatBytes,
  formatDownloadProgress,
} from './model-downloader.ts';

vi.mock('./logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

const globalRef = globalThis as Record<string, unknown>;

function setupWindow() {
  globalRef.window = globalRef.window ?? (globalThis as Window & typeof globalThis);
}

function mockLanguageDetector(availability: Availability = 'downloadable') {
  const instance = {
    detect: vi.fn(),
    destroy: vi.fn(),
  };

  const availabilityMock = vi.fn().mockResolvedValue(availability);
  const createMock = vi.fn().mockResolvedValue(instance);

  globalRef.LanguageDetector = {
    availability: availabilityMock,
    create: createMock,
  };

  return { availabilityMock, createMock, instance };
}

function mockProofreader(options?: {
  availabilitySequence?: Availability[];
  createImpl?: (options?: { monitor?: (monitor: any) => void }) => Promise<Proofreader>;
}) {
  const availabilitySequence = options?.availabilitySequence ?? ['downloadable'];
  const availabilityMock = vi.fn();
  availabilitySequence.forEach((value) => availabilityMock.mockResolvedValueOnce(value));
  availabilityMock.mockResolvedValue(availabilitySequence[availabilitySequence.length - 1]);

  const instance = {
    proofread: vi.fn(),
    destroy: vi.fn(),
  };

  const createImpl =
    options?.createImpl ??
    (async (config?: { monitor?: (monitor: any) => void }) => {
      config?.monitor?.({
        addEventListener: (_event: string, handler: (data: { loaded: number }) => void) => {
          handler({ loaded: 1 });
        },
      });
      return instance as unknown as Proofreader;
    });

  const createMock = vi.fn(createImpl);

  globalRef.Proofreader = {
    availability: availabilityMock,
    create: createMock,
  };

  return { availabilityMock, createMock, instance };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe('model downloader utilities', () => {
  beforeEach(() => {
    setupWindow();
    vi.clearAllMocks();
    delete globalRef.Proofreader;
    delete globalRef.LanguageDetector;
  });

  it('formats bytes using readable units', () => {
    expect(formatBytes(512)).toBe('512.0 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(MODEL_SIZE_BYTES)).toMatch(/GB/);
  });

  it('describes download progress for common states', () => {
    expect(formatDownloadProgress({ state: 'idle', progress: 0 })).toBe('Ready to download');
    expect(formatDownloadProgress({ state: 'checking', progress: 0 })).toBe(
      'Checking availability...'
    );
    expect(
      formatDownloadProgress({
        state: 'downloading',
        progress: 0.5,
        bytesDownloaded: MODEL_SIZE_BYTES / 2,
        totalBytes: MODEL_SIZE_BYTES,
      })
    ).toMatch(/Downloading:/);
    expect(formatDownloadProgress({ state: 'ready', progress: 1 })).toBe('Model ready');
    expect(formatDownloadProgress({ state: 'error', progress: 0, error: new Error('x') })).toBe(
      'Error: x'
    );
    expect(formatDownloadProgress({ state: 'unavailable', progress: 0 })).toBe(
      'Proofreader API not available on this device'
    );
  });

  it('marks proofreader as unavailable when API missing', async () => {
    const downloader = createModelDownloader();
    const availability = await downloader.checkProofreaderAvailability();

    expect(availability).toBe('unavailable');
    expect(downloader.getState()).toMatchObject({
      state: 'unavailable',
      progress: 0,
    });
  });

  it('downloads proofreader and language detector with progress events', async () => {
    const { instance: proofreaderInstance } = mockProofreader({
      availabilitySequence: ['downloadable'],
    });
    const { createMock: languageCreate } = mockLanguageDetector('downloadable');

    const downloader = createModelDownloader({
      expectedInputLanguages: ['en'],
      autoRetry: false,
      maxRetries: 1,
      retryDelayMs: 0,
    });

    const states: DownloadProgress[] = [];
    downloader.on('state-change', (state) => states.push(state));

    const result = await downloader.download();

    expect(result).toBe(proofreaderInstance);
    expect(downloader.isReady()).toBe(true);
    expect(downloader.getProofreader()).toBe(proofreaderInstance);
    expect(
      states.some((state) => state.state === 'downloading' && state.modelType === 'proofreader')
    ).toBe(true);
    expect(languageCreate).toHaveBeenCalled();
  });

  it('prevents concurrent downloads', async () => {
    const deferred = createDeferred<Proofreader>();
    const { instance } = mockProofreader({
      availabilitySequence: ['downloadable'],
      createImpl: () => deferred.promise,
    });
    mockLanguageDetector('downloadable');

    const downloader = createModelDownloader();
    const first = downloader.download();

    await expect(downloader.download()).rejects.toThrow('Download already in progress');

    deferred.resolve(instance as unknown as Proofreader);
    await first;
  });

  it('surface errors when download ultimately fails', async () => {
    mockProofreader({
      availabilitySequence: ['downloadable'],
      createImpl: async () => {
        throw new Error('fail');
      },
    });
    mockLanguageDetector('downloadable');

    const downloader = createModelDownloader({
      autoRetry: false,
      expectedInputLanguages: ['en'],
      maxRetries: 0,
      retryDelayMs: 0,
    });

    await expect(downloader.download()).rejects.toThrow('fail');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(downloader.getState().state).toBe('error');
  });
});
