import { getStorageValues, onStorageChange } from '../../shared/utils/storage.ts';
import { STORAGE_KEYS, STORAGE_DEFAULTS } from '../../shared/constants.ts';
import {
  buildCorrectionColorThemes,
  setActiveCorrectionColors,
  type CorrectionColorConfig,
  type CorrectionColorThemeMap,
  type CorrectionTypeKey,
} from '../../shared/utils/correction-types.ts';
import type { UnderlineStyle } from '../../shared/types.ts';
import type { IssueColorPalette } from '../target-session.ts';

export interface PreferenceManagerEvents {
  onCorrectionTypesChanged?: (types: Set<CorrectionTypeKey>) => void;
  onCorrectionColorsChanged?: (colors: CorrectionColorThemeMap, palette: IssueColorPalette) => void;
  onUnderlineStyleChanged?: (style: UnderlineStyle) => void;
  onAutoCorrectChanged?: (enabled: boolean) => void;
  onProofreadShortcutChanged?: (shortcut: string) => void;
  onAutofixOnDoubleClickChanged?: (enabled: boolean) => void;
}

export class PreferenceManager {
  private enabledCorrectionTypes = new Set<CorrectionTypeKey>();
  private correctionColors: CorrectionColorThemeMap = {} as CorrectionColorThemeMap;
  private underlineStyle: UnderlineStyle = STORAGE_DEFAULTS[
    STORAGE_KEYS.UNDERLINE_STYLE
  ] as UnderlineStyle;
  private autoCorrectEnabled: boolean = STORAGE_DEFAULTS[STORAGE_KEYS.AUTO_CORRECT] as boolean;
  private proofreadShortcut: string = STORAGE_DEFAULTS[STORAGE_KEYS.PROOFREAD_SHORTCUT] as string;
  private autofixOnDoubleClick: boolean = STORAGE_DEFAULTS[
    STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK
  ] as boolean;

  private correctionTypeCleanup: (() => void) | null = null;
  private correctionColorsCleanup: (() => void) | null = null;
  private underlineStyleCleanup: (() => void) | null = null;
  private autoCorrectCleanup: (() => void) | null = null;
  private shortcutStorageCleanup: (() => void) | null = null;
  private autofixCleanup: (() => void) | null = null;

  constructor(private readonly events: PreferenceManagerEvents) {}

  async initialize(): Promise<void> {
    await this.initializeCorrectionPreferences();
    await this.initializeProofreadPreferences();
  }

  destroy(): void {
    this.cleanupHandler(this.correctionTypeCleanup);
    this.correctionTypeCleanup = null;

    this.cleanupHandler(this.correctionColorsCleanup);
    this.correctionColorsCleanup = null;

    this.cleanupHandler(this.underlineStyleCleanup);
    this.underlineStyleCleanup = null;

    this.cleanupHandler(this.autoCorrectCleanup);
    this.autoCorrectCleanup = null;

    this.cleanupHandler(this.shortcutStorageCleanup);
    this.shortcutStorageCleanup = null;

    this.cleanupHandler(this.autofixCleanup);
    this.autofixCleanup = null;
  }

  getEnabledCorrectionTypes(): Set<CorrectionTypeKey> {
    return this.enabledCorrectionTypes;
  }

  getCorrectionColors(): CorrectionColorThemeMap {
    return this.correctionColors;
  }

  getUnderlineStyle(): UnderlineStyle {
    return this.underlineStyle;
  }

  isAutoCorrectEnabled(): boolean {
    return this.autoCorrectEnabled;
  }

  getProofreadShortcut(): string {
    return this.proofreadShortcut;
  }

  isAutofixOnDoubleClickEnabled(): boolean {
    return this.autofixOnDoubleClick;
  }

  buildIssuePalette(): IssueColorPalette {
    return structuredClone(this.correctionColors);
  }

  private async initializeCorrectionPreferences(): Promise<void> {
    const { enabledCorrectionTypes, correctionColors, underlineStyle } = await getStorageValues([
      STORAGE_KEYS.ENABLED_CORRECTION_TYPES,
      STORAGE_KEYS.CORRECTION_COLORS,
      STORAGE_KEYS.UNDERLINE_STYLE,
    ]);

    this.enabledCorrectionTypes = new Set(enabledCorrectionTypes);

    const colorConfig: CorrectionColorConfig = structuredClone(correctionColors);
    this.updateCorrectionColors(colorConfig);
    this.underlineStyle = underlineStyle;
    this.events.onUnderlineStyleChanged?.(underlineStyle);

    this.cleanupHandler(this.correctionTypeCleanup);
    this.correctionTypeCleanup = onStorageChange(
      STORAGE_KEYS.ENABLED_CORRECTION_TYPES,
      (newValue) => {
        this.enabledCorrectionTypes = new Set(newValue);
        this.events.onCorrectionTypesChanged?.(this.enabledCorrectionTypes);
      }
    );

    this.cleanupHandler(this.correctionColorsCleanup);
    this.correctionColorsCleanup = onStorageChange(STORAGE_KEYS.CORRECTION_COLORS, (newValue) => {
      const updatedConfig: CorrectionColorConfig = structuredClone(newValue);
      this.updateCorrectionColors(updatedConfig);
    });

    this.cleanupHandler(this.underlineStyleCleanup);
    this.underlineStyleCleanup = onStorageChange(STORAGE_KEYS.UNDERLINE_STYLE, (newValue) => {
      this.underlineStyle = newValue;
      this.events.onUnderlineStyleChanged?.(newValue);
    });
  }

  private async initializeProofreadPreferences(): Promise<void> {
    const { autoCorrect, proofreadShortcut, autofixOnDoubleClick } = await getStorageValues([
      STORAGE_KEYS.AUTO_CORRECT,
      STORAGE_KEYS.PROOFREAD_SHORTCUT,
      STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK,
    ]);

    this.autoCorrectEnabled = autoCorrect;
    this.proofreadShortcut = proofreadShortcut;
    this.autofixOnDoubleClick = autofixOnDoubleClick;
    this.events.onAutofixOnDoubleClickChanged?.(autofixOnDoubleClick);

    this.cleanupHandler(this.autoCorrectCleanup);
    this.autoCorrectCleanup = onStorageChange(STORAGE_KEYS.AUTO_CORRECT, (newValue) => {
      this.autoCorrectEnabled = newValue;
      this.events.onAutoCorrectChanged?.(newValue);
    });

    this.cleanupHandler(this.shortcutStorageCleanup);
    this.shortcutStorageCleanup = onStorageChange(STORAGE_KEYS.PROOFREAD_SHORTCUT, (newValue) => {
      this.proofreadShortcut = newValue;
      this.events.onProofreadShortcutChanged?.(newValue);
    });

    this.cleanupHandler(this.autofixCleanup);
    this.autofixCleanup = onStorageChange(STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK, (newValue) => {
      this.autofixOnDoubleClick = newValue;
      this.events.onAutofixOnDoubleClickChanged?.(newValue);
    });
  }

  private updateCorrectionColors(colorConfig: CorrectionColorConfig): void {
    this.correctionColors = buildCorrectionColorThemes(colorConfig);
    setActiveCorrectionColors(colorConfig);
    const palette = this.buildIssuePalette();
    this.events.onCorrectionColorsChanged?.(this.correctionColors, palette);
  }

  private cleanupHandler(cleanup: (() => void) | null): void {
    cleanup?.();
  }
}
