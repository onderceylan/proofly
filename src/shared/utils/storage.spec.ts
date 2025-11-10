import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS, STORAGE_DEFAULTS } from '../constants.ts';
import {
  getStorageValue,
  getStorageValues,
  initializeStorage,
  isModelReady,
  onStorageChange,
  setStorageValue,
  setStorageValues,
} from './storage.ts';

type StorageArea = chrome.storage.StorageArea & { data: Record<string, unknown> };

const globalAny = globalThis as any;

describe('storage utilities', () => {
  let syncArea: StorageArea;
  let localArea: StorageArea;
  let listeners: Array<
    (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void
  >;

  const emitChange = (areaName: 'sync' | 'local', data: Record<string, unknown>) => {
    const payload = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        {
          oldValue: undefined,
          newValue: value,
        },
      ])
    );
    listeners.forEach((listener) => listener(payload, areaName));
  };

  const createStorageArea = (areaName: 'sync' | 'local'): StorageArea => {
    return {
      data: {},
      async get(keys?: string | string[]) {
        if (!keys) return { ...this.data };
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          for (const key of keys) {
            if (key in this.data) {
              result[key] = this.data[key];
            }
          }
          return result;
        }
        return { [keys]: this.data[keys] };
      },
      async set(values: Record<string, unknown>) {
        Object.assign(this.data, values);
        emitChange(areaName, values);
      },
    } as StorageArea;
  };

  beforeEach(() => {
    listeners = [];
    syncArea = createStorageArea('sync');
    localArea = createStorageArea('local');

    globalAny.chrome = {
      storage: {
        sync: syncArea,
        local: localArea,
        onChanged: {
          addListener: (fn: (typeof listeners)[number]) => listeners.push(fn),
          removeListener: (fn: (typeof listeners)[number]) => {
            listeners = listeners.filter((listener) => listener !== fn);
          },
        },
      },
    };
  });

  it('reads individual values falling back to defaults', async () => {
    await syncArea.set({ [STORAGE_KEYS.AUTO_CORRECT]: false });
    const result = await getStorageValue(STORAGE_KEYS.AUTO_CORRECT);
    expect(result).toBe(false);

    const fallback = await getStorageValue(STORAGE_KEYS.PROOFREAD_SHORTCUT);
    expect(fallback).toBe(STORAGE_DEFAULTS[STORAGE_KEYS.PROOFREAD_SHORTCUT]);
  });

  it('reads multiple values across both storage areas', async () => {
    await syncArea.set({ [STORAGE_KEYS.UNDERLINE_STYLE]: 'wavy' });
    await localArea.set({ [STORAGE_KEYS.MODEL_DOWNLOADED]: true });

    const values = await getStorageValues([
      STORAGE_KEYS.UNDERLINE_STYLE,
      STORAGE_KEYS.MODEL_DOWNLOADED,
    ]);

    expect(values).toMatchObject({
      [STORAGE_KEYS.UNDERLINE_STYLE]: 'wavy',
      [STORAGE_KEYS.MODEL_DOWNLOADED]: true,
    });
  });

  it('writes values to the correct storage area', async () => {
    await setStorageValue(STORAGE_KEYS.UNDERLINE_STYLE, 'solid');
    expect(syncArea.data[STORAGE_KEYS.UNDERLINE_STYLE]).toBe('solid');

    await setStorageValue(STORAGE_KEYS.MODEL_AVAILABILITY, 'available');
    expect(localArea.data[STORAGE_KEYS.MODEL_AVAILABILITY]).toBe('available');
  });

  it('splits bulk writes between sync and local', async () => {
    await setStorageValues({
      [STORAGE_KEYS.UNDERLINE_STYLE]: 'dotted',
      [STORAGE_KEYS.MODEL_DOWNLOADED]: true,
    });

    expect(syncArea.data[STORAGE_KEYS.UNDERLINE_STYLE]).toBe('dotted');
    expect(localArea.data[STORAGE_KEYS.MODEL_DOWNLOADED]).toBe(true);
  });

  it('reports model readiness when both flags are true', async () => {
    await setStorageValues({
      [STORAGE_KEYS.PROOFREADER_READY]: true,
      [STORAGE_KEYS.MODEL_DOWNLOADED]: true,
    });
    expect(await isModelReady()).toBe(true);
  });

  it('subscribes to storage changes for a specific key', () => {
    const callback = vi.fn();
    const dispose = onStorageChange(STORAGE_KEYS.UNDERLINE_STYLE, callback);

    emitChange('sync', {
      [STORAGE_KEYS.UNDERLINE_STYLE]: 'wavy',
    });

    expect(callback).toHaveBeenCalledWith('wavy', undefined);
    dispose();
    emitChange('sync', {
      [STORAGE_KEYS.UNDERLINE_STYLE]: 'solid',
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('initializes missing defaults across storage areas', async () => {
    await initializeStorage();
    for (const key of Object.keys(STORAGE_DEFAULTS)) {
      const area = Object.prototype.hasOwnProperty.call(syncArea.data, key) ? syncArea : localArea;
      expect(area.data[key]).toBeDefined();
    }
  });
});
