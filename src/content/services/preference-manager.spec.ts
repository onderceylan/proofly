import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PreferenceManager } from './preference-manager.ts';

const mockStorage = {
  get: vi.fn(),
  onChanged: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
};

vi.mock('../../shared/utils/storage.ts', () => ({
  getStorageValues: vi.fn(async (keys) => {
    const defaults: Record<string, any> = {
      correctionTypes: ['spelling', 'grammar'],
      correctionColors: {},
      underlineStyle: 'wavy',
      autoCorrect: true,
      proofreadShortcut: 'Mod+Shift+P',
      autofixOnDoubleClick: false,
    };
    const result: Record<string, any> = {};
    for (const key of keys) {
      result[key] = defaults[key];
    }
    return result;
  }),
  onStorageChange: vi.fn((callback) => {
    mockStorage.onChanged.addListener(callback);
    return () => mockStorage.onChanged.removeListener(callback);
  }),
}));

vi.mock('../../shared/utils/correction-types.ts', () => ({
  buildCorrectionColorThemes: vi.fn(() => ({
    spelling: { color: '#ff0000', background: '#fff0f0', border: '#ffcccc' },
    grammar: { color: '#0000ff', background: '#f0f0ff', border: '#ccccff' },
  })),
  getActiveCorrectionColors: vi.fn(() => ({
    spelling: { color: '#ff0000', background: '#fff0f0', border: '#ffcccc' },
  })),
  setActiveCorrectionColors: vi.fn(),
}));

describe('PreferenceManager', () => {
  let manager: PreferenceManager;
  let callbacks: {
    onCorrectionTypesChanged?: () => void;
    onCorrectionColorsChanged?: (colors: any, palette: any) => void;
    onUnderlineStyleChanged?: (style: string) => void;
    onAutoCorrectChanged?: (enabled: boolean) => void;
    onProofreadShortcutChanged?: (shortcut: string) => void;
    onAutofixOnDoubleClickChanged?: (enabled: boolean) => void;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    callbacks = {
      onCorrectionTypesChanged: vi.fn(),
      onCorrectionColorsChanged: vi.fn(),
      onUnderlineStyleChanged: vi.fn(),
      onAutoCorrectChanged: vi.fn(),
      onProofreadShortcutChanged: vi.fn(),
      onAutofixOnDoubleClickChanged: vi.fn(),
    };
    manager = new PreferenceManager(callbacks);
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('initialize', () => {
    it('should load initial preferences', async () => {
      await manager.initialize();

      expect(manager.getEnabledCorrectionTypes().has('spelling')).toBe(true);
      expect(manager.getEnabledCorrectionTypes().has('grammar')).toBe(true);
      expect(manager.isAutoCorrectEnabled()).toBe(true);
      expect(manager.getUnderlineStyle()).toBe('wavy');
      expect(manager.getProofreadShortcut()).toBe('Mod+Shift+P');
      expect(manager.isAutofixOnDoubleClickEnabled()).toBe(false);
    });
  });

  describe('getEnabledCorrectionTypes', () => {
    it('should return enabled correction types', async () => {
      await manager.initialize();
      const types = manager.getEnabledCorrectionTypes();

      expect(types.size).toBe(2);
      expect(types.has('spelling')).toBe(true);
      expect(types.has('grammar')).toBe(true);
    });
  });

  describe('getCorrectionColors', () => {
    it('should return correction color themes', async () => {
      await manager.initialize();
      const colors = manager.getCorrectionColors();

      expect(colors.spelling).toBeDefined();
      expect(colors.grammar).toBeDefined();
    });
  });

  describe('buildIssuePalette', () => {
    it('should build issue color palette', async () => {
      await manager.initialize();
      const palette = manager.buildIssuePalette();

      expect(palette.spelling).toBeDefined();
      expect(palette.spelling.color).toBeTruthy();
      expect(palette.spelling.background).toBeTruthy();
    });
  });

  describe('getUnderlineStyle', () => {
    it('should return underline style', async () => {
      await manager.initialize();
      expect(manager.getUnderlineStyle()).toBe('wavy');
    });
  });

  describe('isAutoCorrectEnabled', () => {
    it('should return auto-correct setting', async () => {
      await manager.initialize();
      expect(manager.isAutoCorrectEnabled()).toBe(true);
    });
  });

  describe('getProofreadShortcut', () => {
    it('should return proofread shortcut', async () => {
      await manager.initialize();
      expect(manager.getProofreadShortcut()).toBe('Mod+Shift+P');
    });
  });

  describe('isAutofixOnDoubleClickEnabled', () => {
    it('should return autofix on double-click setting', async () => {
      await manager.initialize();
      expect(manager.isAutofixOnDoubleClickEnabled()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should cleanup storage listeners', async () => {
      await manager.initialize();
      manager.destroy();

      expect(mockStorage.onChanged.removeListener).toHaveBeenCalled();
    });
  });
});
