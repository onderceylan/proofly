import type { CorrectionType } from '../types.ts';

export interface CorrectionColorTheme extends CorrectionTypeBase {
  background: string;
  border: string;
}

export interface CorrectionColorConfigEntry {
  color: string;
}

interface CorrectionTypeBase {
  color: string;
  label: string;
  description: string;
  example: string;
}

export const CORRECTION_TYPES = {
  spelling: {
    color: '#EE3120',
    label: 'Spelling',
    description: 'Fixes misspelled words so text stays readable.',
    example: 'Example: "teh" -> "the"',
  },
  grammar: {
    color: '#F29F05',
    label: 'Grammar',
    description: 'Improves sentence structure and subject-verb agreement.',
    example: 'Example: "This are" -> "This is"',
  },
  punctuation: {
    color: '#FF00FF',
    label: 'Punctuation',
    description: 'Adds or fixes commas, periods, and other punctuation marks.',
    example: 'Example: "Lets eat grandma" -> "Let\'s eat, grandma"',
  },
  capitalization: {
    color: '#66C4D9',
    label: 'Capitalization',
    description: 'Corrects uppercase and lowercase usage in text.',
    example: 'Example: "i love Proofly" -> "I love Proofly"',
  },
  preposition: {
    color: '#F27405',
    label: 'Preposition',
    description: 'Suggests more natural prepositions in phrases.',
    example: 'Example: "on the bus" -> "in the bus"',
  },
  'missing-words': {
    color: '#71A64B',
    label: 'Missing Words',
    description: 'Identifies spots where a word should be added.',
    example: 'Example: "I going store" -> "I am going to the store"',
  },
} as const satisfies Record<string, CorrectionTypeBase>;

export type CorrectionTypeKey = keyof typeof CORRECTION_TYPES;
export type CorrectionColorThemeMap = Record<CorrectionTypeKey, CorrectionColorTheme>;
export type CorrectionColorConfig = Record<CorrectionTypeKey, CorrectionColorConfigEntry>;

export const ALL_CORRECTION_TYPES = Object.keys(CORRECTION_TYPES) as CorrectionTypeKey[];

let activeCorrectionColors: CorrectionColorThemeMap = buildCorrectionColorThemes();

export function getDefaultCorrectionColorConfig(): CorrectionColorConfig {
  const config = {} as CorrectionColorConfig;
  for (const type of ALL_CORRECTION_TYPES) {
    const theme = CORRECTION_TYPES[type];
    config[type] = {
      color: theme.color,
    };
  }
  return config;
}

export function buildCorrectionColorThemes(config?: CorrectionColorConfig | null): CorrectionColorThemeMap {
  const merged = {} as CorrectionColorThemeMap;
  for (const type of ALL_CORRECTION_TYPES) {
    const base = CORRECTION_TYPES[type];
    const override = config?.[type];
    const baseColor = override?.color || base.color;
    merged[type] = createThemeFromBase(base, baseColor);
  }
  return merged;
}

export function setActiveCorrectionColors(config?: CorrectionColorConfig | null): void {
  activeCorrectionColors = buildCorrectionColorThemes(config);
}

export function getActiveCorrectionColors(): CorrectionColorThemeMap {
  return structuredClone(activeCorrectionColors);
}

export function getCorrectionTypeColor(type?: CorrectionType | CorrectionTypeKey): CorrectionColorTheme {
  if (!type) return activeCorrectionColors.spelling;
  const key = type as CorrectionTypeKey;
  return activeCorrectionColors[key] || activeCorrectionColors.spelling;
}

export function toCorrectionColorConfig(themes: CorrectionColorThemeMap): CorrectionColorConfig {
  const config = {} as CorrectionColorConfig;
  for (const type of ALL_CORRECTION_TYPES) {
    const theme = themes[type];
    config[type] = {
      color: theme.color,
    };
  }
  return config;
}

function createThemeFromBase(base: CorrectionTypeBase, color: string): CorrectionColorTheme {
  return {
    color,
    background: getColorWithAlpha(color, 0.16),
    border: getColorWithAlpha(color, 0.35),
    label: base.label,
    description: base.description,
    example: base.example,
  };
}

function getColorWithAlpha(hexColor: string, alpha: number): string {
  const normalized = hexColor.trim();
  const hex = normalized.startsWith('#') ? normalized.slice(1) : normalized;
  if (hex.length !== 6) {
    return normalized;
  }

  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
