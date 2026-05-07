import { createModelDownloader, type DownloadProgress } from '../../services/model-downloader.ts';
import { STORAGE_KEYS } from '../constants.ts';

const PROOFREADER_FLAG_URL = 'chrome://flags/#proofreader-api-for-gemini-nano';

export class ModelDownloaderComponent extends HTMLElement {
  private shadow: ShadowRoot;
  private downloader = createModelDownloader();
  private cleanup: Array<() => void> = [];
  private abortController: AbortController | null = null;

  private elements = {
    container: null as HTMLDivElement | null,
    requirements: null as HTMLDivElement | null,
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
    this.render().then(() => {
      this.attachEventListeners();
      this.checkInitialState();
    });
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
      // 1. Check if the flag is even enabled (window check)
      if (!('Proofreader' in window)) {
        this.showError('Built-in AI features are disabled. Please enable the flag below.');
        this.hideDownloadButton();
        return;
      }

      // 2. Check the specific Proofreader availability status
      const availability = await this.downloader.checkProofreaderAvailability();

      switch (availability) {
        case 'available':
          // Model is already on disk
          await this.markModelAsReady();
          this.showSuccess();
          break;

        case 'downloadable':
          // Requirements met, but model is missing
          this.hideError();
          this.showDownloadButton();
          break;

        case 'downloading':
          // Already in progress (perhaps from a previous session)
          this.showProgress();
          break;

        case 'unavailable':
        default:
          // System doesn't meet requirements (GPU, Storage, etc.)
          this.showError('Your system does not meet the hardware requirements for Gemini Nano.');
          this.hideDownloadButton();
          break;
      }
    } catch (err) {
      this.showError(`Initialization failed: ${(err as Error).message}`);
    }
  }

  private async markModelAsReady() {
    await chrome.storage.local.set({
      [STORAGE_KEYS.MODEL_DOWNLOADED]: true,
      [STORAGE_KEYS.PROOFREADER_READY]: true,
      [STORAGE_KEYS.MODEL_AVAILABILITY]: 'available',
    });
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
        `${(error as Error).message} Check requirements and enable the "Proofreader API for Gemini Nano" flag (${PROOFREADER_FLAG_URL}), then retry.`
      );
      this.elements.button.disabled = false;
    }
  }

  private updateProgress(progress: DownloadProgress) {
    if (!this.elements.progress || !this.elements.progressText) return;

    if (
      progress.progress <= 0 ||
      progress.state === 'checking' ||
      progress.state === 'extracting'
    ) {
      this.elements.progress.removeAttribute('value');
    } else {
      this.elements.progress.value = progress.progress;
    }

    const percent = Math.floor(progress.progress * 100);
    const modelLabel =
      progress.modelType === 'language-detector' ? 'Language Detection' : 'Proofreader';

    let text = '';
    switch (progress.state) {
      case 'checking':
        text = `Initializing ${modelLabel.toLowerCase()}...`;
        break;
      case 'extracting':
        text = `Finalizing ${modelLabel.toLowerCase()} setup...`;
        break;
      case 'downloading':
        if (progress.bytesDownloaded && progress.totalBytes) {
          const downloaded = this.formatBytes(progress.bytesDownloaded);
          const total = this.formatBytes(progress.totalBytes);
          text = `Downloading ${modelLabel}: ${downloaded} / ${total} (${percent}%)`;
        } else {
          text = `Downloading ${modelLabel}: ${percent}%`;
        }
        break;
      default:
        text = `Processing...`;
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
    if (this.elements.status?.classList.contains('success')) {
      this.hideStatus();
    }
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

  private hideDownloadButton() {
    if (!this.elements.button) return;
    this.elements.button.style.display = 'none';
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

  private hideStatus() {
    if (!this.elements.status) return;
    this.elements.status.style.display = 'none';
    this.elements.status.className = 'status';
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
      // The handler needs to be bound to 'this' to access class methods
      const handleButtonClick = () => this.handleDownload();
      this.elements.button.addEventListener('click', handleButtonClick);

      // Clean up to avoid memory leaks
      this.cleanup.push(() =>
        this.elements.button?.removeEventListener('click', handleButtonClick)
      );
    }

    // Listen to the downloader service for progress updates
    const unsubscribeProgress = this.downloader.on('state-change', (progress) => {
      this.updateProgress(progress);

      if (progress.state === 'ready') {
        this.showSuccess();
      } else if (progress.state === 'error') {
        this.showError(progress.error?.message || 'Download failed');
      }
    });

    this.cleanup.push(unsubscribeProgress);
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

      progress:not([value]) {
        background-color: #e5e7eb;
      }

      progress:not([value])::-webkit-progress-bar {
        background-image: linear-gradient(
          90deg, 
          #4f46e5 25%, 
          #818cf8 50%, 
          #4f46e5 75%
        );
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite linear;
      }

      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
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

      .requirement-item {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 8px 0;
        font-size: 0.85rem;
        color: #4b5563;
        line-height: 1.4;
      }

      .code-block-wrapper {
        display: inline-flex;
        align-items: center;
        background: #f3f4f6;
        padding: 2px 8px;
        border-radius: 4px;
        margin-left: 4px;
        cursor: pointer;
        border: 1px solid #e5e7eb;
        vertical-align: middle;
      }

      .code-block-wrapper:hover {
        background: #e5e7eb;
      }

      code {
        font-size: 0.75rem;
        color: #1f2937;
      }

      .copy-icon {
        margin-left: 6px;
        font-size: 12px;
        opacity: 0.6;
      }

      .icon-check { color: #10b981; font-weight: bold; }
      .icon-cross { color: #ef4444; font-weight: bold; }
      .icon-pending { color: #9ca3af; }
    `;
  }

  private async render() {
    const isFlagEnabled = 'Proofreader' in window;

    // Check disk space using the Storage Manager API
    const storageInfo = await navigator.storage.estimate();
    const freeSpaceGB =
      storageInfo.quota && storageInfo.usage
        ? (storageInfo.quota - storageInfo.usage) / 1024 ** 3
        : 0;
    const hasEnoughSpace = freeSpaceGB >= 22;

    const container = document.createElement('div');
    container.className = 'container';

    const getReqLine = (text: string, isMet: boolean | null, isFlag = false) => {
      const icon = isMet === true ? '✓' : isMet === false ? '✕' : '○';
      const iconClass =
        isMet === true ? 'icon-check' : isMet === false ? 'icon-cross' : 'icon-pending';

      return `
        <li class="requirement-item">
          <span class="${iconClass}">${icon}</span>
          <span>${text}</span>
          ${
            isFlag && !isMet
              ? `
            <div class="code-block-wrapper" id="copyFlag" title="Click to copy">
              <code>chrome://flags/#proofreader-api-for-gemini-nano</code>
              <span class="copy-icon">📋</span>
            </div>`
              : ''
          }
        </li>
      `;
    };

    container.innerHTML = `
      <h2 class="title">Welcome to Proofly!</h2>
      <p class="description">
        Complete your setup by downloading the AI models to get started. This is a one-time setup.
      </p>
      <div class="requirements">
        <strong>System Check</strong>
        <ul style="list-style: none; padding: 0; margin-top: 8px;">
          ${getReqLine('Chrome 141 or later', true)}
          ${getReqLine('GPU with 4GB+ VRAM', null)}
          ${getReqLine('22 GB available space (only uses 2GB, the 20GB margin is to ensure system stability)', hasEnoughSpace)}
          ${isFlagEnabled ? getReqLine('AI Flag Enabled', true) : getReqLine('Enable AI Flag', false, true)}
        </ul>
      </div>
      <button class="button" type="button">Download AI Model (~2GB)</button>
      <div class="progress-container">
        <progress max="1" value="0" style="display: none;"></progress>
        <div class="progress-text" style="display: none;"></div>
      </div>
      <div class="status" style="display: none;"></div>
      <div class="error" style="display: none;"></div>
    `;

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);
    this.shadow.appendChild(container);

    // Cast types to avoid TS errors
    this.elements = {
      container,
      requirements: container.querySelector('.requirements') as HTMLDivElement,
      button: container.querySelector('.button') as HTMLButtonElement,
      status: container.querySelector('.status') as HTMLDivElement,
      progress: container.querySelector('progress') as HTMLProgressElement,
      progressText: container.querySelector('.progress-text') as HTMLDivElement,
      error: container.querySelector('.error') as HTMLDivElement,
    };
  }
}

customElements.define('proofly-model-downloader', ModelDownloaderComponent);
