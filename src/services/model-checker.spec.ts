import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger.ts';
import { STORAGE_KEYS } from '../shared/constants.ts';
import { ensureProofreaderModelReady } from './model-checker.ts';

const storageMock = vi.hoisted(() => ({
  setStorageValues: vi.fn(),
}));

vi.mock('../shared/utils/storage.ts', () => storageMock);

vi.mock('./logger.ts', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const globalRef = globalThis as Record<string, unknown>;
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
const setStorageValues = storageMock.setStorageValues;

describe('ensureProofreaderModelReady', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalRef.window = globalRef.window ?? (globalThis as Window & typeof globalThis);
    delete globalRef.Proofreader;
  });

  it('marks model unavailable when API missing', async () => {
    const ready = await ensureProofreaderModelReady();
    expect(ready).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'Proofreader API unavailable while checking model readiness'
    );
    expect(setStorageValues).toHaveBeenCalledWith({
      [STORAGE_KEYS.MODEL_AVAILABILITY]: 'unavailable',
      [STORAGE_KEYS.PROOFREADER_READY]: false,
      [STORAGE_KEYS.MODEL_DOWNLOADED]: false,
    });
  });

  it('stores ready state when availability is available', async () => {
    const availabilityMock = vi.fn().mockResolvedValue('available' as Availability);
    globalRef.Proofreader = { availability: availabilityMock };

    const ready = await ensureProofreaderModelReady(['en']);

    expect(ready).toBe(true);
    expect(availabilityMock).toHaveBeenCalledWith({ expectedInputLanguages: ['en'] });
    expect(setStorageValues).toHaveBeenCalledWith({
      [STORAGE_KEYS.MODEL_AVAILABILITY]: 'available',
      [STORAGE_KEYS.PROOFREADER_READY]: true,
      [STORAGE_KEYS.MODEL_DOWNLOADED]: true,
    });
    expect(logger.info).toHaveBeenCalledWith('Proofreader model already available on device');
  });

  it('handles downloading state', async () => {
    const availabilityMock = vi.fn().mockResolvedValue('downloading' as Availability);
    globalRef.Proofreader = { availability: availabilityMock };

    const ready = await ensureProofreaderModelReady();

    expect(ready).toBe(false);
    expect(setStorageValues).toHaveBeenCalledWith({
      [STORAGE_KEYS.MODEL_AVAILABILITY]: 'downloading',
      [STORAGE_KEYS.PROOFREADER_READY]: false,
      [STORAGE_KEYS.MODEL_DOWNLOADED]: false,
    });
    expect(logger.info).toHaveBeenCalledWith('Proofreader model currently downloading');
  });

  it('handles downloadable state', async () => {
    const availabilityMock = vi.fn().mockResolvedValue('downloadable' as Availability);
    globalRef.Proofreader = { availability: availabilityMock };

    const ready = await ensureProofreaderModelReady();

    expect(ready).toBe(false);
    expect(setStorageValues).toHaveBeenCalledWith({
      [STORAGE_KEYS.MODEL_AVAILABILITY]: 'downloadable',
      [STORAGE_KEYS.PROOFREADER_READY]: false,
      [STORAGE_KEYS.MODEL_DOWNLOADED]: false,
    });
    expect(logger.info).toHaveBeenCalledWith(
      'Proofreader model downloadable but not yet installed'
    );
  });

  it('marks unavailable if API reports unavailable', async () => {
    const availabilityMock = vi.fn().mockResolvedValue('unavailable' as Availability);
    globalRef.Proofreader = { availability: availabilityMock };

    const ready = await ensureProofreaderModelReady();

    expect(ready).toBe(false);
    expect(setStorageValues).toHaveBeenCalledWith({
      [STORAGE_KEYS.MODEL_AVAILABILITY]: 'unavailable',
      [STORAGE_KEYS.PROOFREADER_READY]: false,
      [STORAGE_KEYS.MODEL_DOWNLOADED]: false,
    });
    expect(logger.warn).toHaveBeenCalledWith('Proofreader model unavailable on this device');
  });

  it('logs error when availability call fails', async () => {
    const availabilityMock = vi.fn().mockRejectedValue(new Error('boom'));
    globalRef.Proofreader = { availability: availabilityMock };

    const ready = await ensureProofreaderModelReady();

    expect(ready).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      { error: expect.any(Error) },
      'Failed to check proofreader model availability'
    );
  });
});
