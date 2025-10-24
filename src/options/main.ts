import '../shared/components/model-downloader.ts';
import { isModelReady, getStorageValues, onStorageChange, setStorageValue } from '../shared/utils/storage.ts';
import { STORAGE_KEYS } from '../shared/constants.ts';
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
import './style.css';

const LIVE_TEST_SAMPLE_TEXT = `This are a radnom text with a few classic common, and typicla typso and grammar issus. the Proofreader API hopefuly finds them all, lets see. Getting in the bus yea.`;

interface LiveTestControls {
  updateEnabledTypes(types: CorrectionTypeKey[]): void;
  updateColors(config: CorrectionColorConfig): void;
  proofread(): Promise<void>;
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
    const { autoCorrect, underlineStyle, enabledCorrectionTypes, correctionColors } = await getStorageValues([
      STORAGE_KEYS.AUTO_CORRECT,
      STORAGE_KEYS.UNDERLINE_STYLE,
      STORAGE_KEYS.ENABLED_CORRECTION_TYPES,
      STORAGE_KEYS.CORRECTION_COLORS,
    ]);

    let correctionColorConfig: CorrectionColorConfig = structuredClone(correctionColors);
    setActiveCorrectionColors(correctionColorConfig);
    let currentCorrectionThemes = buildCorrectionColorThemes(correctionColorConfig);
    let liveTestControls: LiveTestControls | null = null;
    let currentEnabledCorrectionTypes = [...enabledCorrectionTypes];

    const UNDERLINE_STYLE_TYPE: Record<UnderlineStyle, CorrectionTypeKey> = {
      solid: 'spelling',
      wavy: 'grammar',
      dotted: 'punctuation',
    };

    const underlineStyleOptions = (
      [
        { value: 'solid' as UnderlineStyle, label: 'Solid', sample: 'Correct spelling' },
        { value: 'wavy' as UnderlineStyle, label: 'Wavy', sample: 'Grammar alert' },
        { value: 'dotted' as UnderlineStyle, label: 'Dotted', sample: 'Punctuation check' },
      ]
    ).map(({ value, label, sample }) => {
      const checked = underlineStyle === value ? 'checked' : '';
      return `
            <label class="underline-style-option" data-style="${value}">
              <input type="radio" name="underlineStyle" value="${value}" ${checked} />
              <div class="underline-style-visual">
                <span class="underline-style-label">${label}</span>
                <span class="underline-style-sample underline-style-sample--${value}" data-style-preview="${value}">${sample}</span>
              </div>
            </label>
          `;
    }).join('');

    const correctionTypeOptions = ALL_CORRECTION_TYPES.map((type: CorrectionTypeKey) => {
      const info = currentCorrectionThemes[type];
      const checked = currentEnabledCorrectionTypes.includes(type) ? 'checked' : '';
      return `
            <label class="correction-type-option" data-type="${type}">
              <input type="checkbox" name="correctionType" value="${type}" ${checked} />
              <div class="correction-type-content">
                <span class="correction-type-chip" style="border-color: ${info.border}; background: ${info.background}; color: ${info.color};">${info.label}</span>
                <span class="correction-type-description">
                  ${info.description}
                  <span class="correction-type-example">${info.example}</span>
                </span>
                <div class="correction-type-colors">
                  <label>
                    <span>Accent</span>
                    <input type="color" value="${correctionColorConfig[type].color}" data-type="${type}" />
                  </label>
                  <button type="button" class="correction-color-reset" data-type="${type}">Reset</button>
                </div>
              </div>
            </label>
          `;
    }).join('');

    app.innerHTML = `
      <div class="options-container">
        <header>
          <h1>Proofly Settings</h1>
          <p>Configure your AI proofreading preferences</p>
        </header>
        <main>
          <section class="settings-section">
            <h2>Model Status</h2>
            <div class="status-card">
              <div class="status-indicator ready"></div>
              <div>
                <strong>AI Model Ready</strong>
                <p>The proofreader model is downloaded and ready to use.</p>
              </div>
            </div>
          </section>

          <section class="settings-section">
            <h2>Proofreading</h2>
            <div class="setting-item">
              <div class="setting-info">
                <label for="autoCorrect">Auto-correct</label>
                <p>Automatically check text as you type</p>
              </div>
              <input type="checkbox" id="autoCorrect" ${autoCorrect ? 'checked' : ''} />
            </div>
          </section>

          <section class="settings-section">
            <h2>Appearance</h2>
            <div class="setting-item">
              <div class="setting-info">
                <label for="underlineStyle">Underline Style</label>
                <p>Choose how errors are underlined</p>
              </div>
              <div class="underline-style-options">
                ${underlineStyleOptions}
              </div>
            </div>
          </section>

          <section class="settings-section">
            <h2>Issue Types</h2>
            <p class="section-description">Select which issues Proofly should flag while proofreading.</p>
            <div class="correction-type-grid">
              ${correctionTypeOptions}
            </div>
          </section>

          <section class="settings-section full-width live-test-area">
            <h2>Live Test Area</h2>
            <p class="section-description">Try out the proofreading functionality below. Type or paste text with errors to see real-time corrections.</p>
            <div
              id="liveTestEditor"
              class="live-test-editor"
              contenteditable="true"
              spellcheck="false"
              data-placeholder="Start typing to check for errors..."
            ></div>
          </section>

          <section class="settings-section">
            <h2>About</h2>
            <div class="about-card">
              <p><strong>Proofly</strong> - Privacy-first AI proofreading</p>
              <p>All processing happens on your device. Zero data leaves your computer.</p>
            </div>
          </section>
        </main>
      </div>
    `;

    const liveTestEditor = document.querySelector<HTMLDivElement>('#liveTestEditor');
    if (liveTestEditor) {
      liveTestEditor.textContent = LIVE_TEST_SAMPLE_TEXT;
    }

    const autoCorrectCheckbox = document.querySelector<HTMLInputElement>('#autoCorrect');
    autoCorrectCheckbox?.addEventListener('change', async (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      await setStorageValue(STORAGE_KEYS.AUTO_CORRECT, checked);
    });

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

    const correctionTypeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="correctionType"]'));
    correctionTypeInputs.forEach((input) => {
      input.addEventListener('change', async (event) => {
        const target = event.target as HTMLInputElement;
        const selectedValues = correctionTypeInputs
          .filter((checkbox) => checkbox.checked)
          .map((checkbox) => checkbox.value as CorrectionTypeKey);

        if (selectedValues.length === 0) {
          target.checked = true;
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
        correctionTypeInputs.forEach((checkbox) => {
          checkbox.checked = currentEnabledCorrectionTypes.includes(checkbox.value as CorrectionTypeKey);
        });
        liveTestControls?.updateEnabledTypes(currentEnabledCorrectionTypes);
      }
    );

    const updateOptionStyles = (type: CorrectionTypeKey) => {
      const theme = currentCorrectionThemes[type];
      const option = document.querySelector<HTMLLabelElement>(`.correction-type-option[data-type="${type}"]`);
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

        await setStorageValue(STORAGE_KEYS.CORRECTION_COLORS, correctionColorConfig);
        liveTestControls?.updateColors(correctionColorConfig);
      });
    });

    const resetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button.correction-color-reset[data-type]'));
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

        await setStorageValue(STORAGE_KEYS.CORRECTION_COLORS, correctionColorConfig);
        liveTestControls?.updateColors(correctionColorConfig);
      });
    });

    onStorageChange(
      STORAGE_KEYS.CORRECTION_COLORS,
      (newValue) => {
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
      }
    );

    // Setup live test area proofreading
    liveTestControls = await setupLiveTestArea(currentEnabledCorrectionTypes, correctionColorConfig);
  }
}

async function setupLiveTestArea(
  initialEnabledTypes: CorrectionTypeKey[],
  initialColorConfig: CorrectionColorConfig
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
    console.error('Failed to initialize proofreader for live test area', error);
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
    controller.scheduleProofread(editor);
  });

  const refreshProofreading = async () => {
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
    void refreshProofreading();
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
    proofread: () => refreshProofreading(),
  };
}

initOptions();
