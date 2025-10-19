import { debounce } from '../utils/debounce.ts';
import { getCorrectionTypeColor } from '../utils/correction-colors.ts';
import {
  createProofreader,
  createProofreaderAdapter,
  createProofreadingService,
} from '../../services/proofreader.ts';
import { ContentHighlighter } from '../../content/components/content-highlighter.ts';

export class ProofreadingTextarea extends HTMLElement {
  private shadow: ShadowRoot;
  private cleanup: Array<() => void> = [];
  private proofreaderService: ReturnType<typeof createProofreadingService> | null = null;
  private highlighter = new ContentHighlighter();
  private isInitializing = false;
  private currentCorrections: ProofreadCorrection[] = [];

  private elements = {
    container: null as HTMLDivElement | null,
    editor: null as HTMLDivElement | null,
    correctionsPanel: null as HTMLDivElement | null,
    status: null as HTMLDivElement | null,
    loadingIndicator: null as HTMLDivElement | null,
  };

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  async connectedCallback() {
    this.render();
    await this.initializeProofreader();
    this.attachEventListeners();
    this.setupHighlighterCallback();
  }

  private setupHighlighterCallback() {
    if (this.elements.editor) {
      this.highlighter.setOnCorrectionApplied(this.elements.editor, (updatedCorrections) => {
        this.currentCorrections = updatedCorrections;
        this.updateCorrectionsPanel(updatedCorrections);
      });
    }
  }

  disconnectedCallback() {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.proofreaderService?.destroy();
    this.highlighter.destroy();
  }

  private async initializeProofreader() {
    if (this.isInitializing || this.proofreaderService) return;

    this.isInitializing = true;
    this.showStatus('Initializing proofreader...', 'loading');

    try {
      const proofreader = await createProofreader();
      const adapter = createProofreaderAdapter(proofreader);
      this.proofreaderService = createProofreadingService(adapter);

      this.showStatus('Ready', 'ready');
      this.hideStatus();
    } catch (error) {
      console.error('Failed to initialize proofreader:', error);
      this.showStatus('Failed to initialize proofreader', 'error');
    } finally {
      this.isInitializing = false;
    }
  }

  private attachEventListeners() {
    if (!this.elements.editor) return;

    const debouncedProofread = debounce(async () => {
      await this.proofreadText();
    }, 1000);

    const handleInput = () => {
      debouncedProofread();
    };

    this.elements.editor.addEventListener('input', handleInput);

    this.cleanup.push(() => {
      this.elements.editor?.removeEventListener('input', handleInput);
    });
  }

  private async proofreadText() {
    if (!this.proofreaderService || !this.elements.editor) return;

    const text = this.elements.editor.textContent || '';

    if (!this.proofreaderService.canProofread(text)) {
      this.clearHighlights();
      return;
    }

    this.showLoadingIndicator();

    try {
      const result = await this.proofreaderService.proofread(text);
      this.currentCorrections = result.corrections;
      this.updateHighlights(text, result.corrections);
      this.updateCorrectionsPanel(result.corrections);
    } catch (error) {
      console.error('Proofreading failed:', error);
      this.showStatus('Proofreading failed', 'error');
    } finally {
      this.hideLoadingIndicator();
    }
  }

  private updateHighlights(_text: string, corrections: ProofreadCorrection[]) {
    if (!this.elements.editor) return;

    if (corrections.length === 0) {
      this.clearHighlights();
      return;
    }

    this.highlighter.highlight(this.elements.editor, corrections);
  }

  private updateCorrectionsPanel(corrections: ProofreadCorrection[]) {
    if (!this.elements.correctionsPanel || !this.elements.editor) return;

    if (corrections.length === 0) {
      this.elements.correctionsPanel.innerHTML =
        '<div class="no-corrections">No issues found</div>';
      return;
    }

    const text = this.elements.editor.textContent || '';
    let html = '<div class="corrections-header">Issues found:</div>';

    for (let i = 0; i < corrections.length; i++) {
      const correction = corrections[i];
      const colors = getCorrectionTypeColor(correction.type);
      const originalText = text.substring(
        correction.startIndex,
        correction.endIndex
      );

      html += `
        <div class="correction-item" data-index="${i}">
          <div class="correction-header">
            <span class="correction-type" style="background: ${colors.background}; color: ${colors.color}; border: 1px solid ${colors.border};">
              ${colors.label}
            </span>
          </div>
          <div class="correction-body">
            <div class="correction-text">
              <span class="original">${this.escapeHtml(originalText)}</span>
              <span class="arrow">→</span>
              <span class="corrected">${this.escapeHtml(correction.correction)}</span>
            </div>
            ${correction.explanation ? `<div class="correction-explanation">${this.escapeHtml(correction.explanation)}</div>` : ''}
          </div>
          <button type="button" class="apply-correction" data-index="${i}">Apply</button>
        </div>
      `;
    }

    this.elements.correctionsPanel.innerHTML = html;

    const buttons = this.elements.correctionsPanel.querySelectorAll('.apply-correction');
    buttons.forEach((button) => {
      const handleClick = () => {
        const index = parseInt(button.getAttribute('data-index') || '0', 10);
        this.applyCorrection(index);
      };
      button.addEventListener('click', handleClick);
      this.cleanup.push(() => button.removeEventListener('click', handleClick));
    });
  }

  private applyCorrection(index: number) {
    if (!this.elements.editor || index >= this.currentCorrections.length) return;

    const correction = this.currentCorrections[index];
    const text = this.elements.editor.textContent || '';

    const newText =
      text.substring(0, correction.startIndex) +
      correction.correction +
      text.substring(correction.endIndex);

    this.elements.editor.textContent = newText;

    const lengthDiff = correction.correction.length - (correction.endIndex - correction.startIndex);

    this.currentCorrections = this.currentCorrections
      .filter((_, i) => i !== index)
      .map(c => {
        if (c.startIndex > correction.startIndex) {
          return {
            ...c,
            startIndex: c.startIndex + lengthDiff,
            endIndex: c.endIndex + lengthDiff
          };
        }
        return c;
      });

    this.updateHighlights(newText, this.currentCorrections);
    this.updateCorrectionsPanel(this.currentCorrections);
  }

  private clearHighlights() {
    if (this.elements.editor) {
      this.highlighter.clearHighlights(this.elements.editor);
    }
    if (this.elements.correctionsPanel) {
      this.elements.correctionsPanel.innerHTML =
        '<div class="no-corrections">No issues found</div>';
    }
    this.currentCorrections = [];
  }

  private showStatus(message: string, type: 'loading' | 'ready' | 'error') {
    if (!this.elements.status) return;

    this.elements.status.textContent = message;
    this.elements.status.className = `status ${type}`;
    this.elements.status.style.display = 'block';
  }

  private hideStatus() {
    if (!this.elements.status) return;

    setTimeout(() => {
      if (this.elements.status) {
        this.elements.status.style.display = 'none';
      }
    }, 2000);
  }

  private showLoadingIndicator() {
    if (this.elements.loadingIndicator) {
      this.elements.loadingIndicator.style.display = 'block';
    }
  }

  private hideLoadingIndicator() {
    if (this.elements.loadingIndicator) {
      this.elements.loadingIndicator.style.display = 'none';
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private getStyles(): string {
    return `
      ::highlight(spelling) {
        background-color: #fef2f2;
        text-decoration: underline;
        text-decoration-color: #dc2626;
        text-decoration-thickness: 2px;
      }

      ::highlight(grammar) {
        background-color: #eff6ff;
        text-decoration: underline;
        text-decoration-color: #2563eb;
        text-decoration-thickness: 2px;
      }

      ::highlight(punctuation) {
        background-color: #f5f3ff;
        text-decoration: underline;
        text-decoration-color: #7c3aed;
        text-decoration-thickness: 2px;
      }

      ::highlight(capitalization) {
        background-color: #fff7ed;
        text-decoration: underline;
        text-decoration-color: #ea580c;
        text-decoration-thickness: 2px;
      }

      ::highlight(preposition) {
        background-color: #ecfeff;
        text-decoration: underline;
        text-decoration-color: #0891b2;
        text-decoration-thickness: 2px;
      }

      ::highlight(missing-words) {
        background-color: #f0fdf4;
        text-decoration: underline;
        text-decoration-color: #16a34a;
        text-decoration-thickness: 2px;
      }

      :host {
        display: block;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }

      .container {
        display: flex;
        gap: 1rem;
        flex-direction: column;
      }

      @media (min-width: 768px) {
        .container {
          flex-direction: row;
        }
      }

      .editor-wrapper {
        flex: 1;
        position: relative;
        min-height: 300px;
      }

      .editor-container {
        position: relative;
        width: 100%;
        height: 100%;
        min-height: 300px;
      }

      .input-wrapper {
        position: relative;
        width: 100%;
        height: 100%;
      }

      .editor {
        width: 100%;
        height: 100%;
        min-height: 300px;
        padding: 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 0.375rem;
        background: #ffffff;
        color: #111827;
        font-family: monospace;
        font-size: 0.875rem;
        line-height: 1.5;
        box-sizing: border-box;
        overflow-y: auto;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .editor:focus {
        outline: none;
        border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
      }

      .editor:empty:before {
        content: attr(data-placeholder);
        color: #9ca3af;
        pointer-events: none;
      }

      .status {
        margin-top: 0.5rem;
        padding: 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.875rem;
        display: none;
      }

      .status.loading {
        background: #eff6ff;
        color: #1e40af;
        border: 1px solid #bfdbfe;
      }

      .status.ready {
        background: #d1fae5;
        color: #065f46;
        border: 1px solid #6ee7b7;
      }

      .status.error {
        background: #fee2e2;
        color: #991b1b;
        border: 1px solid #fecaca;
      }

      .loading-indicator {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        padding: 0.25rem 0.5rem;
        background: #eff6ff;
        color: #1e40af;
        border: 1px solid #bfdbfe;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        display: none;
        z-index: 10;
      }

      .corrections-panel {
        flex: 0 0 300px;
        max-height: 500px;
        overflow-y: auto;
        border: 1px solid #e5e7eb;
        border-radius: 0.375rem;
        padding: 1rem;
        background: #f9fafb;
      }

      .corrections-header {
        font-weight: 600;
        margin-bottom: 0.75rem;
        color: #111827;
      }

      .no-corrections {
        color: #6b7280;
        font-size: 0.875rem;
        text-align: center;
        padding: 2rem;
      }

      .correction-item {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 0.375rem;
        padding: 0.75rem;
        margin-bottom: 0.75rem;
      }

      .correction-item:last-child {
        margin-bottom: 0;
      }

      .correction-header {
        display: flex;
        align-items: center;
        margin-bottom: 0.5rem;
      }

      .correction-type {
        padding: 0.125rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-weight: 500;
      }

      .correction-body {
        margin-bottom: 0.5rem;
      }

      .correction-text {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        margin-bottom: 0.5rem;
      }

      .correction-text .original {
        color: #dc2626;
        text-decoration: line-through;
      }

      .correction-text .arrow {
        color: #6b7280;
      }

      .correction-text .corrected {
        color: #16a34a;
        font-weight: 500;
      }

      .correction-explanation {
        font-size: 0.75rem;
        color: #6b7280;
        font-style: italic;
        line-height: 1.4;
      }

      .apply-correction {
        width: 100%;
        background: #4f46e5;
        color: white;
        border: none;
        padding: 0.375rem 0.75rem;
        border-radius: 0.25rem;
        font-size: 0.75rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }

      .apply-correction:hover {
        background: #4338ca;
      }
    `;
  }

  private render() {
    const container = document.createElement('div');
    container.className = 'container';

    const editorWrapper = document.createElement('div');
    editorWrapper.className = 'editor-wrapper';

    const editorContainer = document.createElement('div');
    editorContainer.className = 'editor-container';

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'input-wrapper';
    inputWrapper.style.cssText = 'position: relative; width: 100%; height: 100%;';

    const editor = document.createElement('div');
    editor.className = 'editor';
    editor.contentEditable = 'true';
    editor.setAttribute('data-placeholder', 'Start typing to check for errors...');
    editor.setAttribute('data-placeholder', 'Start typing to check for errors...');
    editor.setAttribute('spellcheck', 'false');

    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.textContent = 'Checking...';

    const status = document.createElement('div');
    status.className = 'status';

    inputWrapper.appendChild(editor);
    editorContainer.appendChild(inputWrapper);
    editorContainer.appendChild(loadingIndicator);

    editorWrapper.appendChild(editorContainer);
    editorWrapper.appendChild(status);

    const correctionsPanel = document.createElement('div');
    correctionsPanel.className = 'corrections-panel';
    correctionsPanel.innerHTML = '<div class="no-corrections">No issues found</div>';

    container.appendChild(editorWrapper);
    container.appendChild(correctionsPanel);

    const style = document.createElement('style');
    style.textContent = this.getStyles();

    this.shadow.appendChild(style);
    this.shadow.appendChild(container);

    this.elements = {
      container,
      editor,
      correctionsPanel,
      status,
      loadingIndicator,
    };
  }
}

customElements.define('proofly-textarea', ProofreadingTextarea);
