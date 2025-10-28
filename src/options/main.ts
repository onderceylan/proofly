import '../shared/components/model-downloader.ts';
import '../shared/components/checkbox.ts';
import type { ProoflyCheckbox } from '../shared/components/checkbox.ts';
import { debounce } from '../shared/utils/debounce.ts';
import { isModelReady, getStorageValues, onStorageChange, setStorageValue } from '../shared/utils/storage.ts';
import { STORAGE_KEYS, STORAGE_DEFAULTS } from '../shared/constants.ts';
import { ContentHighlighter } from '../content/components/content-highlighter.ts';
import {
  createProofreader,
  createProofreaderAdapter,
  createProofreadingService,
} from '../services/proofreader.ts';
import { createProofreadingController } from '../shared/proofreading/controller.ts';
import type { UnderlineStyle } from '../shared/types.ts';
import {
  ALL_CORRECTION_TYPES,
  CORRECTION_TYPES,
  buildCorrectionColorThemes,
  setActiveCorrectionColors,
} from '../shared/utils/correction-types.ts';
import type {
  CorrectionColorConfig,
  CorrectionColorConfigEntry,
  CorrectionTypeKey,
} from '../shared/utils/correction-types.ts';
import { isMacOS } from '../shared/utils/platform.ts';
import './style.css';
import { logger } from "../services/logger.ts";

const LIVE_TEST_SAMPLE_TEXT = `This are a radnom text with a few classic common, and typicla typso and grammar issus. the Proofreader API hopefuly finds them all, lets see. Getting in the bus yea.`;

interface LiveTestControls {
  updateEnabledTypes(types: CorrectionTypeKey[]): void;
  updateColors(config: CorrectionColorConfig): void;
  proofread(): Promise<void>;
}

interface LiveTestAreaOptions {
  isAutoCorrectEnabled: () => boolean;
}

async function initOptions() {
  const app = document.querySelector<HTMLDivElement>('#app')!;

  const modelReady = await isModelReady();

  if (!modelReady) {
    app.innerHTML = `
      <div class="options-container">
        <header>
          <h1>Proofly Settings</h1>
        </header>
        <main>
          <proofly-model-downloader></proofly-model-downloader>
        </main>
      </div>
    `;

    const downloader = app.querySelector('proofly-model-downloader');
    downloader?.addEventListener('download-complete', () => {
      location.reload();
    });
  } else {
    const { autoCorrect, underlineStyle, enabledCorrectionTypes, correctionColors, proofreadShortcut, autofixOnDoubleClick } = await getStorageValues([
      STORAGE_KEYS.AUTO_CORRECT,
      STORAGE_KEYS.UNDERLINE_STYLE,
      STORAGE_KEYS.ENABLED_CORRECTION_TYPES,
      STORAGE_KEYS.CORRECTION_COLORS,
      STORAGE_KEYS.PROOFREAD_SHORTCUT,
      STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK,
    ]);

    let correctionColorConfig: CorrectionColorConfig = structuredClone(correctionColors);
    setActiveCorrectionColors(correctionColorConfig);
    let currentCorrectionThemes = buildCorrectionColorThemes(correctionColorConfig);
    let liveTestControls: LiveTestControls | null = null;
    let currentEnabledCorrectionTypes = [...enabledCorrectionTypes];
    let currentProofreadShortcut = proofreadShortcut;
    let autoCorrectEnabled = autoCorrect;
    let autofixEnabled = autofixOnDoubleClick;

    const DEFAULT_PROOFREAD_SHORTCUT = STORAGE_DEFAULTS[STORAGE_KEYS.PROOFREAD_SHORTCUT];
    const persistCorrectionColors = debounce((config: CorrectionColorConfig) => {
      void setStorageValue(STORAGE_KEYS.CORRECTION_COLORS, structuredClone(config)).catch((error) => {
        logger.error({ error }, 'Failed to persist correction colors');
      });
    }, 500);

    const isMac = isMacOS();
    const displayMap: Record<string, string> = isMac
      ? { Mod: '⌘', Shift: '⇧', Alt: '⌥' }
      : { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt' };

    const specialKeys: Record<string, string> = {
      ArrowUp: '↑',
      ArrowDown: '↓',
      ArrowLeft: '←',
      ArrowRight: '→',
      Space: 'Space',
      Enter: 'Enter',
      Backspace: 'Backspace',
      Delete: 'Delete',
      Tab: 'Tab',
      Home: 'Home',
      End: 'End',
      PageUp: 'PageUp',
      PageDown: 'PageDown',
    };

    const formatShortcut = (value: string): string => {
      if (!value) return 'Not set';
      return value.split('+').map((part) => {
        if (displayMap[part]) return displayMap[part];
        const special = specialKeys[part];
        if (special) return special;
        if (part.length === 1) return part.toUpperCase();
        return part.charAt(0).toUpperCase() + part.slice(1);
      }).join(' + ');
    };

    const buildShortcutFromEvent = (event: KeyboardEvent): string | null => {
      const key = event.key;

      if (key === 'Escape') {
        return 'ESC_CANCEL';
      }

      const modifiers: string[] = [];
      if (event.metaKey || event.ctrlKey) modifiers.push('Mod');
      if (event.altKey) modifiers.push('Alt');
      if (event.shiftKey) modifiers.push('Shift');

      if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') {
        return null;
      }

      if (modifiers.length === 0) {
        return null;
      }

      let normalizedKey: string;
      if (key === ' ') {
        normalizedKey = 'Space';
      } else if (key.length === 1) {
        normalizedKey = key.toUpperCase();
      } else {
        normalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
      }

      return [...modifiers, normalizedKey].join('+');
    };

    const UNDERLINE_STYLE_TYPE: Record<UnderlineStyle, CorrectionTypeKey> = {
      solid: 'spelling',
      wavy: 'spelling',
      dotted: 'spelling',
    };

    const underlineStyleOptions = (
      [
        { value: 'solid' as UnderlineStyle, label: 'Solid', sample: 'speling mystake' },
        { value: 'wavy' as UnderlineStyle, label: 'Wavy', sample: 'speling mystake' },
        { value: 'dotted' as UnderlineStyle, label: 'Dotted', sample: 'speling mystake' },
      ]
    ).map(({ value, label, sample }) => {
      const checked = underlineStyle === value ? 'checked' : '';
      return `
            <label class="underline-style-option" data-style="${value}">
              <input type="radio" name="underlineStyle" value="${value}" ${checked} />
              <div class="underline-style-visual">
                <span class="setting-option-title">${label}</span>
                <span class="underline-style-sample underline-style-sample--${value}" data-style-preview="${value}">${sample}</span>
              </div>
            </label>
          `;
    }).join('');

    const correctionTypeOptions = ALL_CORRECTION_TYPES.map((type: CorrectionTypeKey) => {
      const info = currentCorrectionThemes[type];
      const checked = currentEnabledCorrectionTypes.includes(type) ? 'checked' : '';
      return `
            <prfly-checkbox class="option-card" data-type="${type}" name="correctionType" value="${type}" ${checked}>
              <div class="correction-type-content">
                <span class="correction-type-chip" style="border-color: ${info.border}; background: ${info.background}; color: ${info.color}; -webkit-text-stroke: 0.2px rgba(0,0,0,0.3)">${info.label}</span>
                <span class="correction-type-description">
                  ${info.description}
                  <span class="correction-type-example">${info.example}</span>
                </span>
                <div class="correction-type-colors">
                  <label>
                    <span>Accent</span>
                    <input type="color" value="${correctionColorConfig[type].color}" data-type="${type}" data-checkbox-interactive />
                  </label>
                  <button type="button" class="reset-button" data-type="${type}" data-checkbox-interactive>Reset</button>
                </div>
              </div>
            </prfly-checkbox>
          `;
    }).join('');

    app.innerHTML = `
      <div class="options-container">
        <header>
          <h1>Proofly Settings</h1>
          <p>Configure your AI proofreading preferences</p>
        </header>
        <main>
          <section class="settings-section full-width">
            <h2>Model Status</h2>
            <p class="section-description">Review the status of AI models.</p>
            <div class="section-items">
              <div class="status-card">
                <div class="status-indicator ready"></div>
                <div>
                  <strong>AI Model Ready</strong>
                  <p>The proofreader model is downloaded and ready to use.</p>
                </div>
              </div>
            </div>
          </section>

          <section class="settings-section">
            <h2>Proofreading</h2>
            <p class="section-description">Select how Proofly should trigger proofreading.</p>
            <div class="section-items">
              <div class="option-card">
                <prfly-checkbox
                  id="autoCorrect"
                  class="option-card option-card--single"
                  aria-labelledby="autoCorrectTitle"
                  ${autoCorrect ? 'checked' : ''}
                >
                  <div class="setting-option-content">
                    <span id="autoCorrectTitle" class="setting-option-title">Auto-correct</span>
                    <span class="setting-option-description">Automatically check text as you type.</span>
                  </div>
                </prfly-checkbox>
              </div>

              <div class="option-card">
                <prfly-checkbox
                  id="autofixOnDoubleClick"
                  class="option-card option-card--single"
                  aria-labelledby="autofixTitle"
                  ${autofixOnDoubleClick ? 'checked' : ''}
                >
                  <div class="setting-option-content">
                    <span id="autofixTitle" class="setting-option-title">Autofix on double-click</span>
                    <span class="setting-option-description">Fix issues by double-clicking on them.</span>
                    <p class="setting-option-hint">Single-click won't show the correction popover.</p>
                  </div>
                </prfly-checkbox>
              </div>

              <div class="option-card option-card--shortcut">
                <div class="setting-option-content">
                  <span id="manualTriggerTitle" class="setting-option-title">Manual trigger</span>
                  <span class="setting-option-description">Trigger proofreading on the active element when auto-correct is turned off.</span>
                  <p class="setting-option-hint" id="proofreadShortcutHint">Click the shortcut below to record a new key combination. Press <strong>esc</strong> to cancel.</p>
                </div>
                <div class="shortcut-actions">
                  <button type="button" class="shortcut-button" id="proofreadShortcutButton" data-checkbox-interactive></button>
                  <button type="button" class="reset-button shortcut-reset" id="proofreadShortcutReset" data-checkbox-interactive>Reset</button>
                </div>
              </div>
            </div>
            
          </section>

          <section class="settings-section">
            <h2>Highlight Style</h2>
            <p class="section-description">Select how Proofly should highlight issues.</p>
            <div class="section-items">
                ${underlineStyleOptions}
            </div>
          </section>

          <section class="settings-section full-width">
            <h2>Issue Types</h2>
            <p class="section-description">Select which issues Proofly should flag while proofreading.</p>
            <div class="section-items correction-type-grid">
              ${correctionTypeOptions}
            </div>
          </section>

          <section class="settings-section full-width live-test-area">
            <h2>Live Test Area</h2>
            <p class="section-description">Try out the proofreading functionality below. Type text with errors to see real-time corrections. <br>Update your preferences and test them live.</p>
            <div
              id="liveTestEditor"
              class="live-test-editor"
              contenteditable="plaintext-only"
              spellcheck="false"
              data-placeholder="Start typing to check for errors..."
            ></div>
          </section>
        </main>
      </div>
    `;

    const liveTestEditor = document.querySelector<HTMLDivElement>('#liveTestEditor');
    if (liveTestEditor) {
      liveTestEditor.textContent = LIVE_TEST_SAMPLE_TEXT;
    }

    const autoCorrectCheckbox = document.querySelector<ProoflyCheckbox>('prfly-checkbox#autoCorrect');
    if (autoCorrectCheckbox) {
      autoCorrectCheckbox.checked = autoCorrectEnabled;
      autoCorrectCheckbox.addEventListener('change', async () => {
        autoCorrectEnabled = autoCorrectCheckbox.checked;
        await setStorageValue(STORAGE_KEYS.AUTO_CORRECT, autoCorrectEnabled);
        if (autoCorrectEnabled) {
          void liveTestControls?.proofread();
        }
      });
    }

    const autofixCheckbox = document.querySelector<ProoflyCheckbox>('prfly-checkbox#autofixOnDoubleClick');
    if (autofixCheckbox) {
      autofixCheckbox.checked = autofixEnabled;
      autofixCheckbox.addEventListener('change', async () => {
        autofixEnabled = autofixCheckbox.checked;
        await setStorageValue(STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK, autofixEnabled);
      });
    }

    const shortcutButton = document.querySelector<HTMLButtonElement>('#proofreadShortcutButton');
    const shortcutResetButton = document.querySelector<HTMLButtonElement>('#proofreadShortcutReset');
    const shortcutHint = document.querySelector<HTMLParagraphElement>('#proofreadShortcutHint');

    const updateShortcutDisplay = () => {
      if (shortcutButton) {
        shortcutButton.textContent = formatShortcut(currentProofreadShortcut);
      }
    };

    updateShortcutDisplay();

    let captureCleanup: (() => void) | null = null;
    let isRecordingShortcut = false;

    const finishShortcutCapture = (apply: boolean, value?: string) => {
      if (captureCleanup) {
        captureCleanup();
        captureCleanup = null;
      }

      isRecordingShortcut = false;
      shortcutButton?.removeAttribute('data-capturing');

      if (apply && value) {
        currentProofreadShortcut = value;
        updateShortcutDisplay();
        void setStorageValue(STORAGE_KEYS.PROOFREAD_SHORTCUT, value).catch((error) => {
          logger.error('Failed to persist proofread shortcut', error);
        });
      } else {
        updateShortcutDisplay();
      }

      if (shortcutHint) {
        shortcutHint.textContent = 'Click the shortcut to record a new key combination. Press Esc to cancel.';
      }
    };

    const startShortcutCapture = () => {
      if (!shortcutButton || captureCleanup) {
        return;
      }

      isRecordingShortcut = true;
      shortcutButton.dataset.capturing = 'true';
      shortcutButton.textContent = 'Press shortcut…';
      if (shortcutHint) {
        shortcutHint.textContent = 'Press the new shortcut now. Esc cancels.';
      }

      const handleKeyDown = (event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const combo = buildShortcutFromEvent(event);
        if (combo === 'ESC_CANCEL') {
          finishShortcutCapture(false);
          return;
        }

        if (!combo) {
          return;
        }

        finishShortcutCapture(true, combo);
      };

      const handleBlur = () => {
        finishShortcutCapture(false);
      };

      document.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('blur', handleBlur, true);

      captureCleanup = () => {
        document.removeEventListener('keydown', handleKeyDown, true);
        window.removeEventListener('blur', handleBlur, true);
        shortcutButton.removeAttribute('data-capturing');
      };

      shortcutButton.focus();
    };

    shortcutButton?.addEventListener('click', (event) => {
      event.preventDefault();
      startShortcutCapture();
    });

    shortcutResetButton?.addEventListener('click', () => {
      finishShortcutCapture(false);
      currentProofreadShortcut = DEFAULT_PROOFREAD_SHORTCUT;
      updateShortcutDisplay();
      void setStorageValue(STORAGE_KEYS.PROOFREAD_SHORTCUT, DEFAULT_PROOFREAD_SHORTCUT).catch((error) => {
        logger.error({ error },'Failed to reset proofread shortcut');
      });
    });

    const handlePageShortcut = (event: KeyboardEvent) => {
      if (isRecordingShortcut || autoCorrectEnabled) {
        return;
      }

      const combo = buildShortcutFromEvent(event);
      if (combo === 'ESC_CANCEL') {
        return;
      }
      if (combo && combo === currentProofreadShortcut) {
        event.preventDefault();
        event.stopPropagation();
        void liveTestControls?.proofread();
      }
    };

    document.addEventListener('keydown', handlePageShortcut, true);

    const updateUnderlinePreviewStyles = () => {
      (['solid', 'wavy', 'dotted'] as UnderlineStyle[]).forEach((style) => {
        const preview = document.querySelector<HTMLElement>(`.underline-style-sample[data-style-preview="${style}"]`);
        if (!preview) return;
        const theme = currentCorrectionThemes[UNDERLINE_STYLE_TYPE[style]];
        preview.style.setProperty('text-decoration-color', theme.color);
      });
    };

    updateUnderlinePreviewStyles();

    const underlineRadios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="underlineStyle"]'));
    underlineRadios.forEach((radio) => {
      radio.addEventListener('change', async () => {
        if (radio.checked) {
          await setStorageValue(STORAGE_KEYS.UNDERLINE_STYLE, radio.value as UnderlineStyle);
        }
      });
    });

    const correctionTypeCheckboxes = Array.from(
      document.querySelectorAll<ProoflyCheckbox>('prfly-checkbox[name="correctionType"]')
    );
    correctionTypeCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener('change', async (event) => {
        // Ignore change events that bubble up from descendant elements (like color inputs)
        // Only handle changes that originate from the checkbox itself
        if (event.target !== event.currentTarget) {
          return;
        }

        const selectedValues = correctionTypeCheckboxes
          .filter((item) => item.checked)
          .map((item) => item.value as CorrectionTypeKey);

        if (selectedValues.length === 0) {
          checkbox.checked = true;
          return;
        }

        const ordered = ALL_CORRECTION_TYPES.filter((type) => selectedValues.includes(type));
        currentEnabledCorrectionTypes = ordered;
        await setStorageValue(STORAGE_KEYS.ENABLED_CORRECTION_TYPES, ordered);
        liveTestControls?.updateEnabledTypes(ordered);
      });
    });

    onStorageChange(
      STORAGE_KEYS.ENABLED_CORRECTION_TYPES,
      (newValue) => {
        currentEnabledCorrectionTypes = [...newValue];
        correctionTypeCheckboxes.forEach((checkbox) => {
          checkbox.checked = currentEnabledCorrectionTypes.includes(checkbox.value as CorrectionTypeKey);
        });
        liveTestControls?.updateEnabledTypes(currentEnabledCorrectionTypes);
      }
    );

    onStorageChange(STORAGE_KEYS.AUTO_CORRECT, (newValue) => {
      autoCorrectEnabled = newValue;
      if (autoCorrectCheckbox) {
        autoCorrectCheckbox.checked = newValue;
      }
      if (newValue) {
        void liveTestControls?.proofread();
      }
    });

    onStorageChange(STORAGE_KEYS.AUTOFIX_ON_DOUBLE_CLICK, (newValue) => {
      autofixEnabled = newValue;
      if (autofixCheckbox) {
        autofixCheckbox.checked = newValue;
      }
    });

    const updateOptionStyles = (type: CorrectionTypeKey) => {
      const theme = currentCorrectionThemes[type];
      const option = document.querySelector<ProoflyCheckbox>(`prfly-checkbox.option-card[data-type="${type}"]`);
      if (!option) return;
      const chip = option.querySelector<HTMLElement>('.correction-type-chip');
      if (chip) {
        chip.style.borderColor = theme.border;
        chip.style.backgroundColor = theme.background;
        chip.style.color = theme.color;
      }
    };

    const colorInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="color"][data-type]'));
    colorInputs.forEach((input) => {
      input.addEventListener('input', async (event) => {
        const target = event.target as HTMLInputElement;
        const type = target.dataset.type as CorrectionTypeKey | undefined;
        if (!type) {
          return;
        }

        const updatedEntry: CorrectionColorConfigEntry = {
          color: target.value,
        };

        correctionColorConfig = {
          ...correctionColorConfig,
          [type]: updatedEntry,
        };

        setActiveCorrectionColors(correctionColorConfig);
        currentCorrectionThemes = buildCorrectionColorThemes(correctionColorConfig);
        updateOptionStyles(type);
        updateUnderlinePreviewStyles();

        persistCorrectionColors(correctionColorConfig);
        liveTestControls?.updateColors(correctionColorConfig);
      });
    });

    const resetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button.reset-button[data-type]'));
    resetButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        const type = button.dataset.type as CorrectionTypeKey | undefined;
        if (!type) return;

        const defaultColor = CORRECTION_TYPES[type].color;
        correctionColorConfig = {
          ...correctionColorConfig,
          [type]: { color: defaultColor },
        };

        const inputEl = document.querySelector<HTMLInputElement>(`input[type="color"][data-type="${type}"]`);
        if (inputEl) {
          inputEl.value = defaultColor;
        }

        setActiveCorrectionColors(correctionColorConfig);
        currentCorrectionThemes = buildCorrectionColorThemes(correctionColorConfig);
        updateOptionStyles(type);
        updateUnderlinePreviewStyles();

        persistCorrectionColors(correctionColorConfig);
        liveTestControls?.updateColors(correctionColorConfig);
      });
    });

    onStorageChange(STORAGE_KEYS.CORRECTION_COLORS, (newValue) => {
      persistCorrectionColors.cancel();
      correctionColorConfig = structuredClone(newValue);
      currentCorrectionThemes = buildCorrectionColorThemes(correctionColorConfig);
      setActiveCorrectionColors(correctionColorConfig);

      for (const type of ALL_CORRECTION_TYPES) {
        updateOptionStyles(type);
        const inputEl = document.querySelector<HTMLInputElement>(`input[type="color"][data-type="${type}"]`);
        if (inputEl) {
          inputEl.value = correctionColorConfig[type].color;
        }
      }
      updateUnderlinePreviewStyles();
      liveTestControls?.updateColors(correctionColorConfig);
    });

    onStorageChange(STORAGE_KEYS.PROOFREAD_SHORTCUT, (newValue) => {
      finishShortcutCapture(false);
      currentProofreadShortcut = newValue;
      updateShortcutDisplay();
    });

    // Setup live test area proofreading
    liveTestControls = await setupLiveTestArea(
      currentEnabledCorrectionTypes,
      correctionColorConfig,
      {
        isAutoCorrectEnabled: () => autoCorrectEnabled,
      }
    );
  }
}

async function setupLiveTestArea(
  initialEnabledTypes: CorrectionTypeKey[],
  initialColorConfig: CorrectionColorConfig,
  options: LiveTestAreaOptions
): Promise<LiveTestControls | null> {
  const editor = document.getElementById('liveTestEditor');
  if (!editor) return null;

  const highlighter = new ContentHighlighter();
  let enabledTypes = new Set<CorrectionTypeKey>(initialEnabledTypes);
  let colorConfig = structuredClone(initialColorConfig);
  let colorThemes = buildCorrectionColorThemes(colorConfig);

  setActiveCorrectionColors(colorConfig);
  highlighter.setCorrectionColors(colorThemes);

  let proofreaderService: ReturnType<typeof createProofreadingService> | null = null;

  try {
    const proofreader = await createProofreader();
    const adapter = createProofreaderAdapter(proofreader);
    proofreaderService = createProofreadingService(adapter);
  } catch (error) {
    logger.error({ error }, 'Failed to initialize proofreader for live test area');
    return null;
  }

  const controller = createProofreadingController({
    runProofread: async (_element, text) => {
      if (!proofreaderService || !proofreaderService.canProofread(text)) {
        return null;
      }

      return proofreaderService.proofread(text);
    },
    filterCorrections: (_element, corrections, text) => {
      const trimmedLength = text.trimEnd().length;
      return corrections
        .filter((correction) => correction.startIndex < trimmedLength)
        .filter((correction) => {
          if (!correction.type) {
            return true;
          }
          return enabledTypes.has(correction.type as CorrectionTypeKey);
        });
    },
    debounceMs: 1000,
    getElementText: (element) => element.textContent || '',
  });

  controller.registerTarget({
    element: editor,
    hooks: {
      highlight: (corrections) => {
        highlighter.highlight(editor, corrections);
      },
      clearHighlights: () => {
        highlighter.clearHighlights(editor);
      },
      onCorrectionsChange: () => undefined,
    },
  });

  highlighter.setApplyCorrectionCallback(editor, (_target, correction) => {
    controller.applyCorrection(editor, correction);
  });

  editor.addEventListener('input', () => {
    if (options.isAutoCorrectEnabled()) {
      controller.scheduleProofread(editor);
    }
  });

  editor.addEventListener('focus', () => {
    if (options.isAutoCorrectEnabled()) {
      void controller.proofread(editor);
    }
  });

  const refreshProofreading = async (force = false) => {
    if (!force && !options.isAutoCorrectEnabled()) {
      return;
    }

    controller.resetElement(editor);
    await controller.proofread(editor, { force: true });
  };

  const updateEnabledTypes = (types: CorrectionTypeKey[]) => {
    enabledTypes = new Set(types);

    if ('highlights' in CSS) {
      for (const type of ALL_CORRECTION_TYPES) {
        if (!enabledTypes.has(type)) {
          const highlight = (CSS.highlights as any).get(type);
          highlight?.clear?.();
        }
      }
    }

    void refreshProofreading();
  };

  const updateColors = (config: CorrectionColorConfig) => {
    colorConfig = structuredClone(config);
    colorThemes = buildCorrectionColorThemes(colorConfig);
    setActiveCorrectionColors(colorConfig);
    highlighter.setCorrectionColors(colorThemes);
  };

  onStorageChange(
    STORAGE_KEYS.ENABLED_CORRECTION_TYPES,
    (newValue) => {
      updateEnabledTypes(newValue);
    }
  );

  onStorageChange(
    STORAGE_KEYS.CORRECTION_COLORS,
    (newValue) => {
      updateColors(newValue);
    }
  );

  await refreshProofreading();

  return {
    updateEnabledTypes,
    updateColors,
    proofread: () => refreshProofreading(true),
  };
}

initOptions();
