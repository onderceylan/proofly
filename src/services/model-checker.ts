import { logger } from './logger.ts';
import { STORAGE_KEYS } from '../shared/constants.ts';
import { setStorageValues } from '../shared/utils/storage.ts';

type ModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

async function updateStorage(
  availability: ModelAvailability,
  isReady: boolean,
  isDownloaded: boolean
): Promise<void> {
  await setStorageValues({
    [STORAGE_KEYS.MODEL_AVAILABILITY]: availability,
    [STORAGE_KEYS.PROOFREADER_READY]: isReady,
    [STORAGE_KEYS.MODEL_DOWNLOADED]: isDownloaded,
  });
}

export async function ensureProofreaderModelReady(
  expectedInputLanguages: string[] = ['en']
): Promise<boolean> {
  if (!('Proofreader' in window)) {
    logger.warn('Proofreader API unavailable while checking model readiness');
    await updateStorage('unavailable', false, false);
    return false;
  }

  try {
    const availability = await Proofreader.availability({
      expectedInputLanguages,
    });

    if (availability === 'available') {
      await updateStorage('available', true, true);
      logger.info('Proofreader model already available on device');
      return true;
    }

    if (availability === 'downloading') {
      await updateStorage('downloading', false, false);
      logger.info('Proofreader model currently downloading');
      return false;
    }

    if (availability === 'downloadable') {
      await updateStorage('downloadable', false, false);
      logger.info('Proofreader model downloadable but not yet installed');
      return false;
    }

    await updateStorage('unavailable', false, false);
    logger.warn('Proofreader model unavailable on this device');
    return false;
  } catch (error) {
    logger.error({ error }, 'Failed to check proofreader model availability');
    return false;
  }
}
