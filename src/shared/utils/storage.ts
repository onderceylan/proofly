/**
 * Chrome Storage Utilities
 *
 * Type-safe wrapper around Chrome storage API for managing extension state.
 * User settings are stored in sync storage to sync across devices.
 * Model-related data is stored in local storage as it's device-specific.
 */

import { STORAGE_KEYS, STORAGE_DEFAULTS } from '../constants.ts';
import type { UnderlineStyle } from '../types.ts';
import type { CorrectionColorConfig, CorrectionTypeKey } from './correction-types.ts';

export interface StorageData {
  [STORAGE_KEYS.MODEL_DOWNLOADED]: boolean;
  [STORAGE_KEYS.MODEL_AVAILABILITY]: Availability;
  [STORAGE_KEYS.PROOFREADER_READY]: boolean;
  [STORAGE_KEYS.AUTO_CORRECT]: boolean;
  [STORAGE_KEYS.UNDERLINE_STYLE]: UnderlineStyle;
  [STORAGE_KEYS.ENABLED_CORRECTION_TYPES]: CorrectionTypeKey[];
  [STORAGE_KEYS.CORRECTION_COLORS]: CorrectionColorConfig;
  [STORAGE_KEYS.PROOFREAD_SHORTCUT]: string;
  [STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK]: boolean;
}

/**
 * Keys that should be stored in sync storage (user preferences)
 */
const SYNC_KEYS = [
  STORAGE_KEYS.AUTO_CORRECT,
  STORAGE_KEYS.UNDERLINE_STYLE,
  STORAGE_KEYS.ENABLED_CORRECTION_TYPES,
  STORAGE_KEYS.CORRECTION_COLORS,
  STORAGE_KEYS.PROOFREAD_SHORTCUT,
  STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK,
] as const;

/**
 * Determine which storage area to use for a given key
 */
function getStorageArea(key: string): chrome.storage.StorageArea {
  return SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number])
    ? chrome.storage.sync
    : chrome.storage.local;
}

/**
 * Get a value from Chrome storage
 */
export async function getStorageValue<K extends keyof StorageData>(
  key: K
): Promise<StorageData[K]> {
  const storage = getStorageArea(key);
  const result = await storage.get(key);
  if (result[key] !== undefined) {
    return cloneValue(result[key]) as StorageData[K];
  }

  const fallback = STORAGE_DEFAULTS[key];
  return cloneValue(fallback) as StorageData[K];
}

/**
 * Get multiple values from Chrome storage
 */
export async function getStorageValues<K extends keyof StorageData>(
  keys: K[]
): Promise<Pick<StorageData, K>> {
  const data = {} as Pick<StorageData, K>;

  // Group keys by storage area
  const syncKeys = keys.filter((k) => SYNC_KEYS.includes(k as (typeof SYNC_KEYS)[number]));
  const localKeys = keys.filter((k) => !SYNC_KEYS.includes(k as (typeof SYNC_KEYS)[number]));

  // Fetch from both storage areas in parallel
  const [syncResult, localResult] = await Promise.all([
    syncKeys.length > 0
      ? chrome.storage.sync.get(syncKeys).then((result) => result as Partial<StorageData>)
      : Promise.resolve<Partial<StorageData>>({}),
    localKeys.length > 0
      ? chrome.storage.local.get(localKeys).then((result) => result as Partial<StorageData>)
      : Promise.resolve<Partial<StorageData>>({}),
  ]);

  // Merge results with defaults
  for (const key of keys) {
    const result = SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number]) ? syncResult : localResult;
    const value = result[key];
    if (value !== undefined) {
      data[key] = cloneValue(value) as StorageData[typeof key];
      continue;
    }

    const fallback = STORAGE_DEFAULTS[key];
    data[key] = cloneValue(fallback) as StorageData[typeof key];
  }

  return data;
}

/**
 * Set a value in Chrome storage
 */
export async function setStorageValue<K extends keyof StorageData>(
  key: K,
  value: StorageData[K]
): Promise<void> {
  const storage = getStorageArea(key);
  await storage.set({ [key]: value });
}

/**
 * Set multiple values in Chrome storage
 */
export async function setStorageValues(data: Partial<StorageData>): Promise<void> {
  const syncData: Partial<StorageData> = {};
  const localData: Partial<StorageData> = {};

  // Split data by storage area
  for (const [key, value] of Object.entries(data)) {
    if (SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number])) {
      syncData[key as keyof StorageData] = value as never;
    } else {
      localData[key as keyof StorageData] = value as never;
    }
  }

  // Write to both storage areas in parallel
  await Promise.all([
    Object.keys(syncData).length > 0 ? chrome.storage.sync.set(syncData) : Promise.resolve(),
    Object.keys(localData).length > 0 ? chrome.storage.local.set(localData) : Promise.resolve(),
  ]);
}

/**
 * Check if the proofreader model is ready
 */
export async function isModelReady(): Promise<boolean> {
  const { proofreaderReady, modelDownloaded } = await getStorageValues([
    STORAGE_KEYS.PROOFREADER_READY,
    STORAGE_KEYS.MODEL_DOWNLOADED,
  ]);

  return proofreaderReady && modelDownloaded;
}

/**
 * Listen for storage changes
 */
export function onStorageChange<K extends keyof StorageData>(
  key: K,
  callback: (newValue: StorageData[K], oldValue: StorageData[K]) => void
): () => void {
  const expectedArea = SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number]) ? 'sync' : 'local';

  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === expectedArea && changes[key]) {
      const change = changes[key];
      const newValue = change.newValue as StorageData[K];
      const oldValue = change.oldValue as StorageData[K];
      callback(newValue, oldValue);
    }
  };

  chrome.storage.onChanged.addListener(listener);

  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}

/**
 * Initialize storage with default values if not set
 */
export async function initializeStorage(): Promise<void> {
  const allKeys = Object.keys(STORAGE_DEFAULTS);
  const syncKeys = allKeys.filter((k) => SYNC_KEYS.includes(k as (typeof SYNC_KEYS)[number]));
  const localKeys = allKeys.filter((k) => !SYNC_KEYS.includes(k as (typeof SYNC_KEYS)[number]));

  // Fetch current values from both storage areas
  const [syncValues, localValues] = await Promise.all([
    syncKeys.length > 0 ? chrome.storage.sync.get(syncKeys) : Promise.resolve({}),
    localKeys.length > 0 ? chrome.storage.local.get(localKeys) : Promise.resolve({}),
  ]);

  const syncUpdates: Partial<StorageData> = {};
  const localUpdates: Partial<StorageData> = {};

  // Check which defaults need to be set
  for (const [key, defaultValue] of Object.entries(STORAGE_DEFAULTS)) {
    if (SYNC_KEYS.includes(key as (typeof SYNC_KEYS)[number])) {
      if (!(key in syncValues)) {
        syncUpdates[key as keyof StorageData] = cloneValue(defaultValue) as never;
      }
    } else {
      if (!(key in localValues)) {
        localUpdates[key as keyof StorageData] = cloneValue(defaultValue) as never;
      }
    }
  }

  // Write defaults to both storage areas in parallel
  await Promise.all([
    Object.keys(syncUpdates).length > 0 ? chrome.storage.sync.set(syncUpdates) : Promise.resolve(),
    Object.keys(localUpdates).length > 0
      ? chrome.storage.local.set(localUpdates)
      : Promise.resolve(),
  ]);
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return [...value] as T;
  }

  if (value && typeof value === 'object') {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value));
    }
  }

  return value;
}
