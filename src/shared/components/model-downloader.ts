import { createModelDownloader, type DownloadProgress } from '../../services/model-downloader.ts';
import { STORAGE_KEYS } from '../constants.ts';

export class ModelDownloaderComponent extends HTMLElement {
  private shadow: ShadowRoot;
  private downloader = createModelDownloader();
  private cleanup: Array<() => void> = [];
  private abortController: AbortController | null = null;

  private elements = {
    container: null as HTMLDivElement | null,
    status: null as HTMLDivElement | null,
    button: null as HTMLButtonElement | null,
    progress: null as HTMLProgressElement | null,
    progressText: null as HTMLDivElement | null,
    error: null as HTMLDivElement | null,
  };

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this.attachEventListeners();
    this.checkInitialState();
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.downloader.destroy();
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private async checkInitialState() {
    try {
      if (!('Proofreader' in window)) {
        this.showError(
          'Proofreader API not found. This feature requires Chrome 141+ with the AI Proofreader API enabled. ' +
            'Please enable "Proofreader API for Gemini Nano" on chrome://flags/#proofreader-api-for-gemini-nano.'
        );
        return;
      }

      const proofreaderAvailability = await this.downloader.checkProofreaderAvailability();
      // Check language detector availability to trigger download if needed
      await this.downloader.checkLanguageDetectorAvailability();

      if (proofreaderAvailability === 'unavailable') {
        this.showError(
          'Proofreader API is unavailable on this device. Requirements:\n' +
            '• Chrome 141 or later\n' +
            '• At least 22 GB free storage\n' +
            '• GPU with 4GB+ VRAM\n' +
            '• Enable chrome://flags/#proofreader-api-for-gemini-nano'
        );
        return;
      }

      if (proofreaderAvailability === 'available') {
        await chrome.storage.local.set({
          [STORAGE_KEYS.MODEL_DOWNLOADED]: true,
          [STORAGE_KEYS.PROOFREADER_READY]: true,
          [STORAGE_KEYS.MODEL_AVAILABILITY]: 'available',
        });
        this.showSuccess();
        return;
      }

      this.showDownloadButton();
    } catch (error) {
      this.showError(`${(error as Error).message}`);
    }
  }

  private async handleDownload() {
    if (!this.elements.button) return;

    try {
      this.elements.button.disabled = true;
      this.hideError();
      this.showProgress();

      this.abortController = new AbortController();

      await this.downloader.download(this.abortController.signal);

      await chrome.storage.local.set({
        [STORAGE_KEYS.MODEL_DOWNLOADED]: true,
        [STORAGE_KEYS.PROOFREADER_READY]: true,
        [STORAGE_KEYS.MODEL_AVAILABILITY]: 'available',
      });

      this.showSuccess();

      this.dispatchEvent(
        new CustomEvent('download-complete', {
          bubbles: true,
          composed: true,
        })
      );
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this.showDownloadButton();
        return;
      }

      this.showError(
        `${(error as Error).message} Check requirements and make sure to enable the flags then retry.`
      );
      this.elements.button.disabled = false;
    }
  }

  private updateProgress(progress: DownloadProgress) {
    if (!this.elements.progress || !this.elements.progressText) return;

    this.elements.progress.value = progress.progress;

    const percent = Math.floor(progress.progress * 100);
    const modelLabel =
      progress.modelType === 'language-detector' ? 'Language Detection' : 'Proofreader';
    let text = `${modelLabel}: ${percent}%`;

    if (progress.state === 'downloading' && progress.bytesDownloaded && progress.totalBytes) {
      const downloaded = this.formatBytes(progress.bytesDownloaded);
      const total = this.formatBytes(progress.totalBytes);
      text = `${modelLabel}: ${downloaded} / ${total} (${percent}%)`;
    } else if (progress.state === 'extracting') {
      text = `Extracting ${modelLabel.toLowerCase()} model...`;
    } else if (progress.state === 'checking') {
      text = `Checking ${modelLabel.toLowerCase()} availability...`;
    }

    this.elements.progressText.textContent = text;
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  private showDownloadButton() {
    if (!this.elements.container || !this.elements.button) return;

    this.elements.container.classList.remove('hidden');
    this.elements.button.style.display = 'inline-block';
    this.hideProgress();
    this.hideSuccess();
  }

  private showProgress() {
    if (!this.elements.progress || !this.elements.progressText || !this.elements.button) return;

    this.elements.button.style.display = 'none';
    this.elements.progress.style.display = 'block';
    this.elements.progressText.style.display = 'block';
  }

  private hideProgress() {
    if (!this.elements.progress || !this.elements.progressText) return;

    this.elements.progress.style.display = 'none';
    this.elements.progressText.style.display = 'none';
  }

  private showSuccess() {
    if (!this.elements.container || !this.elements.status) return;

    this.elements.status.textContent = '✓ Models ready';
    this.elements.status.style.display = 'block';
    this.elements.status.className = 'status success';
    this.hideProgress();
    if (this.elements.button) {
      this.elements.button.style.display = 'none';
    }
  }

  private hideSuccess() {
    if (!this.elements.status) return;
    this.elements.status.style.display = 'none';
  }

  private showError(message: string) {
    if (!this.elements.error) return;

    this.elements.error.textContent = message;
    this.elements.error.style.display = 'block';
  }

  private hideError() {
    if (!this.elements.error) return;

    this.elements.error.style.display = 'none';
  }

  private attachEventListeners() {
    if (this.elements.button) {
      const handleClick = () => this.handleDownload();
      this.elements.button.addEventListener('click', handleClick);
      this.cleanup.push(() => this.elements.button?.removeEventListener('click', handleClick));
    }

    const unsubscribeProgress = this.downloader.on('download-progress', (progress) => {
      this.updateProgress(progress);
    });
    this.cleanup.push(unsubscribeProgress);

    const unsubscribeError = this.downloader.on('error', (error) => {
      this.showError(error.message);
    });
    this.cleanup.push(unsubscribeError);
  }

  private getStyles(): string {
    return `
      :host {
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .container {
        padding: 2rem;
        text-align: center;
        background: #f9fafb;
        border-radius: 0.5rem;
        border: 1px solid #e5e7eb;
      }

      .container.hidden {
        display: none;
      }

      .title {
        font-size: 1.25rem;
        font-weight: 600;
        color: #111827;
        margin: 0 0 0.5rem 0;
      }

      .description {
        font-size: 0.875rem;
        color: #6b7280;
        margin: 0 0 1.5rem 0;
        line-height: 1.5;
      }

      .requirements {
        font-size: 0.75rem;
        color: #9ca3af;
        margin: 0 0 1.5rem 0;
        padding: 0.75rem;
        background: #ffffff;
        border-radius: 0.375rem;
        border: 1px solid #e5e7eb;
      }

      .requirements ul {
        margin: 0.5rem 0 0 0;
        padding-left: 1.5rem;
        text-align: left;
      }

      .requirements li {
        margin: 0.25rem 0;
      }

      .button {
        background: #4f46e5;
        color: white;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 0.375rem;
        font-size: 1rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }

      .button:hover:not(:disabled) {
        background: #4338ca;
      }

      .button:disabled {
        background: #9ca3af;
        cursor: not-allowed;
      }

      .progress-container {
        margin-top: 1rem;
      }

      progress {
        width: 100%;
        height: 8px;
        border-radius: 4px;
        overflow: hidden;
        -webkit-appearance: none;
        appearance: none;
      }

      progress::-webkit-progress-bar {
        background-color: #e5e7eb;
        border-radius: 4px;
      }

      progress::-webkit-progress-value {
        background-color: #4f46e5;
        border-radius: 4px;
        transition: width 0.3s ease;
      }

      progress::-moz-progress-bar {
        background-color: #4f46e5;
        border-radius: 4px;
      }

      .progress-text {
        margin-top: 0.5rem;
        font-size: 0.875rem;
        color: #6b7280;
      }

      .status {
        margin-top: 1rem;
        padding: 0.75rem;
        border-radius: 0.375rem;
        font-weight: 500;
      }

      .status.success {
        background: #d1fae5;
        color: #065f46;
        border: 1px solid #6ee7b7;
      }

      .error {
        margin-top: 1rem;
        padding: 0.75rem;
        background: #fee2e2;
        color: #991b1b;
        border: 1px solid #fecaca;
        border-radius: 0.375rem;
        font-size: 0.875rem;
        display: none;
        white-space: pre-line;
        text-align: left;
      }
    `;
  }

  private render() {
    const container = document.createElement('div');
    container.className = 'container';

    const title = document.createElement('h2');
    title.className = 'title';
    title.textContent = 'Welcome to Proofly!';

    const description = document.createElement('p');
    description.className = 'description';
    description.innerHTML =
      'Download the AI models to get started with on-device proofreading with language detection. <br>This is a one-time setup.';

    const requirements = document.createElement('div');
    requirements.className = 'requirements';
    requirements.innerHTML = `
      <strong>Requirements</strong>
      <ul>
        <li>Chrome 141 or later</li>
        <li>Enable chrome://flags/#proofreader-api-for-gemini-nano</li>
        <li>At least 22 GB free storage</li>
        <li>GPU with 4GB+ VRAM</li>
        <li>Unmetered network connection for one-off model download</li>
      </ul>
    `;

    const button = document.createElement('button');
    button.className = 'button';
    button.type = 'button';
    button.textContent = 'Download AI Model (~22GB)';

    const progressContainer = document.createElement('div');
    progressContainer.className = 'progress-container';

    const progress = document.createElement('progress');
    progress.max = 1;
    progress.value = 0;
    progress.style.display = 'none';

    const progressText = document.createElement('div');
    progressText.className = 'progress-text';
    progressText.style.display = 'none';

    const status = document.createElement('div');
    status.className = 'status';
    status.style.display = 'none';

    const error = document.createElement('div');
    error.className = 'error';

    progressContainer.appendChild(progress);
    progressContainer.appendChild(progressText);

    container.appendChild(title);
    container.appendChild(description);
    container.appendChild(requirements);
    container.appendChild(button);
    container.appendChild(progressContainer);
    container.appendChild(status);
    container.appendChild(error);

    const style = document.createElement('style');
    style.textContent = this.getStyles();

    this.shadow.appendChild(style);
    this.shadow.appendChild(container);

    this.elements = {
      container,
      status,
      button,
      progress,
      progressText,
      error,
    };
  }
}

customElements.define('proofly-model-downloader', ModelDownloaderComponent);
