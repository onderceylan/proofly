import '../shared/components/model-downloader.ts';
import { isModelReady, getStorageValue, setStorageValue } from '../shared/utils/storage.ts';
import { STORAGE_KEYS } from '../shared/constants.ts';
import { ContentHighlighter } from '../content/components/content-highlighter.ts';
import {
  createProofreader,
  createProofreaderAdapter,
  createProofreadingService,
} from '../services/proofreader.ts';
import { debounce } from '../shared/utils/debounce.ts';
import './style.css';

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
    const autoCorrect = await getStorageValue(STORAGE_KEYS.AUTO_CORRECT);

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

          <section class="settings-section full-width">
            <h2>Live Test Area</h2>
            <p class="section-description">Try out the proofreading functionality below. Type or paste text with errors to see real-time corrections.</p>
            <div
              id="liveTestEditor"
              contenteditable="true"
              spellcheck="false"
              style="min-height: 200px; padding: 12px; border: 1px solid #d1d5db; border-radius: 6px; background: white; font-family: monospace; font-size: 14px; line-height: 1.5;"
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

    const autoCorrectCheckbox = document.querySelector<HTMLInputElement>('#autoCorrect');
    autoCorrectCheckbox?.addEventListener('change', async (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      await setStorageValue(STORAGE_KEYS.AUTO_CORRECT, checked);
    });

    // Setup live test area proofreading
    await setupLiveTestArea();
  }
}

async function setupLiveTestArea() {
  const editor = document.getElementById('liveTestEditor');
  if (!editor) return;

  const highlighter = new ContentHighlighter();
  let proofreaderService: ReturnType<typeof createProofreadingService> | null = null;

  // Initialize proofreader
  try {
    const proofreader = await createProofreader();
    const adapter = createProofreaderAdapter(proofreader);
    proofreaderService = createProofreadingService(adapter);
    console.log('Proofly: Proofreader initialized for live test area');
  } catch (error) {
    console.error('Failed to initialize proofreader:', error);
    return;
  }

  // Setup debounced proofreading on input
  const debouncedProofread = debounce(async () => {
    if (!proofreaderService || !editor) return;

    const text = editor.textContent || '';

    if (!proofreaderService.canProofread(text)) {
      highlighter.clearHighlights(editor);
      return;
    }

    try {
      const result = await proofreaderService.proofread(text);

      if (result.corrections.length > 0) {
        highlighter.highlight(editor, result.corrections);
      } else {
        highlighter.clearHighlights(editor);
      }

      console.log(`Proofly: Found ${result.corrections.length} corrections`);
    } catch (error) {
      console.error('Proofreading failed:', error);
    }
  }, 1000);

  // Setup callback for when corrections are applied via popover
  highlighter.setOnCorrectionApplied(editor, (updatedCorrections) => {
    console.log(`Proofly: Correction applied, ${updatedCorrections.length} remaining`);
  });

  editor.addEventListener('input', () => {
    debouncedProofread();
  });

  console.log('Proofly: Live test area setup complete');
}

initOptions();
