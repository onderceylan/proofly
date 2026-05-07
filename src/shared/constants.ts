import type { UnderlineStyle, ModelSource, ApiConfig } from './types.ts';
import { ALL_CORRECTION_TYPES, getDefaultCorrectionColorConfig } from './utils/correction-types.ts';

/**
 * Storage keys for Chrome storage API
 */
export const STORAGE_KEYS = {
  MODEL_DOWNLOADED: 'modelDownloaded',
  MODEL_AVAILABILITY: 'modelAvailability',
  PROOFREADER_READY: 'proofreaderReady',
  AUTO_CORRECT: 'autoCorrect',
  UNDERLINE_STYLE: 'underlineStyle',
  ENABLED_CORRECTION_TYPES: 'enabledCorrectionTypes',
  CORRECTION_COLORS: 'correctionColors',
  PROOFREAD_SHORTCUT: 'proofreadShortcut',
  AUTOFIX_ON_DOUBLE_CLICK: 'autofixOnDoubleClick',
  MODEL_SOURCE: 'modelSource',
  API_CONFIG: 'apiConfig',
} as const;

/**
 * Default storage values
 */
export const STORAGE_DEFAULTS = {
  [STORAGE_KEYS.MODEL_DOWNLOADED]: false,
  [STORAGE_KEYS.MODEL_AVAILABILITY]: 'unavailable' as Availability,
  [STORAGE_KEYS.PROOFREADER_READY]: false,
  [STORAGE_KEYS.AUTO_CORRECT]: true,
  [STORAGE_KEYS.UNDERLINE_STYLE]: 'solid' as UnderlineStyle,
  [STORAGE_KEYS.ENABLED_CORRECTION_TYPES]: ALL_CORRECTION_TYPES,
  [STORAGE_KEYS.CORRECTION_COLORS]: getDefaultCorrectionColorConfig(),
  [STORAGE_KEYS.PROOFREAD_SHORTCUT]: 'Mod+Shift+P',
  [STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK]: false,
  [STORAGE_KEYS.MODEL_SOURCE]: 'local' as ModelSource,
  [STORAGE_KEYS.API_CONFIG]: {
    type: 'claude',
    apiUrl: 'https://api.anthropic.com',
    apiKey: '',
    selectedModel: '',
    selectedModelDisplayName: '',
  } as ApiConfig,
} as const;
