import { logger } from '../../services/logger.ts';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <style>
    :host {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    button {
      appearance: none;
      border: 1px solid rgba(0, 0, 0, 0.15);
      border-radius: 6px;
      background: #111827;
      color: #ffffff;
      font-size: 12px;
      padding: 8px 12px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      opacity: 0.8;
      transition: opacity 120ms ease;
    }

    button:hover:not(:disabled),
    button:focus-visible {
      opacity: 1;
    }

    button:disabled {
      cursor: progress;
      opacity: 0.6;
    }
  </style>
  <button type="button" part="button" aria-label="Open Proofly sidebar">Proofly Sidebar</button>
`;

export class ProoflySidepanelToggleButton extends HTMLElement {
  private shadow: ShadowRoot;
  private button: HTMLButtonElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
  }

  disconnectedCallback(): void {
    this.button?.removeEventListener('click', this.handleClick);
  }

  private render(): void {
    this.shadow.innerHTML = '';
    this.shadow.appendChild(TEMPLATE.content.cloneNode(true));
    this.button = this.shadow.querySelector('button');

    if (!this.button) {
      return;
    }

    this.button.addEventListener('click', this.handleClick);
  }

  private handleClick = async (): Promise<void> => {
    if (!chrome?.runtime?.sendMessage || !this.button) {
      return;
    }

    this.button.disabled = true;
    try {
      await chrome.runtime.sendMessage({
        type: 'proofly:open-sidepanel-dev',
        payload: { action: 'toggle' },
      });
    } catch (error) {
      logger.error({ error }, 'Failed to toggle sidepanel from dev helper');
    } finally {
      this.button.disabled = false;
    }
  };
}

customElements.define('prfly-sidepanel-toggle', ProoflySidepanelToggleButton);
