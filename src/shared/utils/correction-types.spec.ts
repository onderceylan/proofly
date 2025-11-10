import { describe, expect, it, beforeEach } from 'vitest';

import {
  ALL_CORRECTION_TYPES,
  buildCorrectionColorThemes,
  getActiveCorrectionColors,
  getCorrectionTypeColor,
  getDefaultCorrectionColorConfig,
  setActiveCorrectionColors,
  toCorrectionColorConfig,
} from './correction-types.ts';

describe('correction type utilities', () => {
  beforeEach(() => {
    setActiveCorrectionColors();
  });

  it('exposes default config for every correction type', () => {
    const config = getDefaultCorrectionColorConfig();
    expect(Object.keys(config)).toEqual(ALL_CORRECTION_TYPES);
    for (const key of ALL_CORRECTION_TYPES) {
      expect(config[key].color).toBeTruthy();
    }
  });

  it('builds themes with override colors and computed layers', () => {
    const overrides = getDefaultCorrectionColorConfig();
    overrides.spelling = { color: '#0000ff' };
    const themes = buildCorrectionColorThemes(overrides);
    expect(themes.spelling.color).toBe('#0000ff');
    expect(themes.spelling.background).toContain('rgba(');
    expect(themes.grammar.color).not.toBe('#0000ff');
  });

  it('tracks active color set and falls back to spelling type', () => {
    const overrides = getDefaultCorrectionColorConfig();
    overrides.grammar = { color: '#111111' };
    setActiveCorrectionColors(overrides);
    const active = getActiveCorrectionColors();
    expect(active.grammar.color).toBe('#111111');
    expect(getCorrectionTypeColor('grammar').color).toBe('#111111');
    expect(getCorrectionTypeColor('unknown' as any).color).toBe(active.spelling.color);
    expect(getCorrectionTypeColor().color).toBe(active.spelling.color);
  });

  it('converts themes back into config stubs', () => {
    const overrides = getDefaultCorrectionColorConfig();
    overrides.punctuation = { color: '#123456' };
    const themes = buildCorrectionColorThemes(overrides);
    const config = toCorrectionColorConfig(themes);
    expect(config.punctuation.color).toBe('#123456');
    expect(Object.keys(config)).toHaveLength(ALL_CORRECTION_TYPES.length);
  });
});
