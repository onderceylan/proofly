import '../../shared/components/logo.ts';
import { getCorrectionTypeColor } from '../../shared/utils/correction-types.ts';
import type {
  IssuesUpdatePayload,
  IssueElementGroup,
  IssueElementKind,
  IssueGroupError,
  SidepanelIssue,
} from '../../shared/messages/issues.ts';

const PANEL_HEADING = 'Suggested Corrections';
const EMPTY_STATE_MESSAGE = `Start typing on the page to see proofreading suggestions.`;

type FixAllIssuesEventDetail = {
  elementId?: string;
};
type PreviewIssueEventDetail = {
  issueId: string;
  elementId: string;
  active: boolean;
};

export class ProoflyIssuesPanel extends HTMLElement {
  private readonly shadow: ShadowRoot;
  private state: IssuesUpdatePayload | null = null;
  private readonly handleClickBound = this.handleClick.bind(this);
  private readonly handlePointerOverBound = this.handlePointerOver.bind(this);
  private readonly handlePointerOutBound = this.handlePointerOut.bind(this);
  private readonly handleFocusInBound = this.handleFocusIn.bind(this);
  private readonly handleFocusOutBound = this.handleFocusOut.bind(this);
  private currentPreview: { issueId: string; elementId: string } | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.shadow.addEventListener('click', this.handleClickBound);
    this.shadow.addEventListener('pointerover', this.handlePointerOverBound);
    this.shadow.addEventListener('pointerout', this.handlePointerOutBound);
    this.shadow.addEventListener('focusin', this.handleFocusInBound);
    this.shadow.addEventListener('focusout', this.handleFocusOutBound);
    this.render();
  }

  disconnectedCallback(): void {
    this.shadow.removeEventListener('click', this.handleClickBound);
    this.shadow.removeEventListener('pointerover', this.handlePointerOverBound);
    this.shadow.removeEventListener('pointerout', this.handlePointerOutBound);
    this.shadow.removeEventListener('focusin', this.handleFocusInBound);
    this.shadow.removeEventListener('focusout', this.handleFocusOutBound);
  }

  setState(state: IssuesUpdatePayload | null): void {
    this.state = state;
    this.render();
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;

    if (target.closest('.settings-btn')) {
      event.preventDefault();
      this.dispatchEvent(
        new CustomEvent('open-settings', {
          bubbles: true,
          composed: true,
        })
      );
      return;
    }

    const fixAllButton = target.closest<HTMLButtonElement>('.fix-all-btn');
    if (fixAllButton) {
      if (fixAllButton.disabled) {
        return;
      }
      event.preventDefault();
      this.dispatchEvent(
        new CustomEvent<FixAllIssuesEventDetail>('fix-all-issues', {
          detail: {},
          bubbles: true,
          composed: true,
        })
      );
      return;
    }

    const groupFixAllButton = target.closest<HTMLButtonElement>('.group__fix-all-btn');
    if (groupFixAllButton) {
      if (groupFixAllButton.disabled) {
        return;
      }
      const elementId = groupFixAllButton.dataset.elementId;
      if (!elementId) {
        return;
      }
      event.preventDefault();
      this.dispatchEvent(
        new CustomEvent<FixAllIssuesEventDetail>('fix-all-issues', {
          detail: { elementId },
          bubbles: true,
          composed: true,
        })
      );
      return;
    }

    const card = target.closest('.issue');
    if (!card) {
      return;
    }

    event.preventDefault();

    const issueId = card.getAttribute('data-issue-id');
    const elementId = card.getAttribute('data-element-id');

    if (!issueId || !elementId) {
      return;
    }

    this.emitApplyIssue(issueId, elementId);
  }

  private handlePointerOver(event: Event): void {
    const pointerEvent = event as PointerEvent;
    const issue = this.resolveIssueTarget(pointerEvent.target);
    if (!issue) {
      return;
    }

    const related = pointerEvent.relatedTarget as HTMLElement | null;
    if (related && issue.node.contains(related)) {
      return;
    }

    this.updatePreviewState(issue.issueId, issue.elementId, true);
  }

  private handlePointerOut(event: Event): void {
    const pointerEvent = event as PointerEvent;
    const issue = this.resolveIssueTarget(pointerEvent.target);
    if (!issue) {
      return;
    }

    const related = pointerEvent.relatedTarget as HTMLElement | null;
    if (related && issue.node.contains(related)) {
      return;
    }

    this.updatePreviewState(issue.issueId, issue.elementId, false);
  }

  private handleFocusIn(event: Event): void {
    const focusEvent = event as FocusEvent;
    const issue = this.resolveIssueTarget(focusEvent.target);
    if (!issue) {
      return;
    }

    const related = focusEvent.relatedTarget as HTMLElement | null;
    if (related && issue.node.contains(related)) {
      return;
    }

    this.updatePreviewState(issue.issueId, issue.elementId, true);
  }

  private handleFocusOut(event: Event): void {
    const focusEvent = event as FocusEvent;
    const issue = this.resolveIssueTarget(focusEvent.target);
    if (!issue) {
      return;
    }

    const related = focusEvent.relatedTarget as HTMLElement | null;
    if (related && issue.node.contains(related)) {
      return;
    }

    this.updatePreviewState(issue.issueId, issue.elementId, false);
  }

  private emitApplyIssue(issueId: string, elementId: string): void {
    this.dispatchEvent(
      new CustomEvent('apply-issue', {
        detail: { issueId, elementId },
        bubbles: true,
        composed: true,
      })
    );
  }

  private resolveIssueTarget(target: EventTarget | null): {
    node: HTMLElement;
    issueId: string;
    elementId: string;
  } | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }

    const node = target.closest<HTMLElement>('.issue');
    if (!node) {
      return null;
    }

    const issueId = node.getAttribute('data-issue-id');
    const elementId = node.getAttribute('data-element-id');
    if (!issueId || !elementId) {
      return null;
    }

    return { node, issueId, elementId };
  }

  private updatePreviewState(issueId: string, elementId: string, active: boolean): void {
    if (active) {
      if (
        this.currentPreview &&
        this.currentPreview.issueId === issueId &&
        this.currentPreview.elementId === elementId
      ) {
        return;
      }

      if (this.currentPreview) {
        this.dispatchPreviewIssue({
          issueId: this.currentPreview.issueId,
          elementId: this.currentPreview.elementId,
          active: false,
        });
      }

      this.currentPreview = { issueId, elementId };
      this.dispatchPreviewIssue({ issueId, elementId, active: true });
      return;
    }

    if (
      this.currentPreview &&
      this.currentPreview.issueId === issueId &&
      this.currentPreview.elementId === elementId
    ) {
      this.dispatchPreviewIssue({ issueId, elementId, active: false });
      this.currentPreview = null;
    }
  }

  private dispatchPreviewIssue(detail: PreviewIssueEventDetail): void {
    this.dispatchEvent(
      new CustomEvent<PreviewIssueEventDetail>('preview-issue', {
        detail,
        bubbles: true,
        composed: true,
      })
    );
  }

  private reconcilePreviewState(): void {
    if (!this.currentPreview) {
      return;
    }

    const selector = `.issue[data-issue-id="${this.currentPreview.issueId}"][data-element-id="${this.currentPreview.elementId}"]`;
    const stillExists = this.shadow.querySelector(selector);
    if (!stillExists) {
      this.dispatchPreviewIssue({
        issueId: this.currentPreview.issueId,
        elementId: this.currentPreview.elementId,
        active: false,
      });
      this.currentPreview = null;
    }
  }

  private render(): void {
    const groups = this.state?.elements ?? [];
    const totalIssues = groups.reduce((count, group) => count + group.issues.length, 0);
    const hasGroups = groups.some(
      (group) => group.issues.length > 0 || (group.errors && group.errors.length > 0)
    );
    const settingsIconUrl = chrome.runtime.getURL('settings.svg');
    const fixAllIconUrl = chrome.runtime.getURL('check-circle.svg');

    this.shadow.innerHTML = `
      <style>
        ${this.getStyles()}
      </style>
      <div class="panel">
        <header class="panel__header">
          <div class="panel__header-left">
            <prfly-logo size="32"></prfly-logo>
            <h1>${this.escapeHtml(PANEL_HEADING)}</h1>
          </div>
          <div class="panel__header-right">
            ${this.renderIssueSummary(totalIssues)}
            <button
              type="button"
              class="panel-action-btn fix-all-btn"
              title="Apply all corrections for the page"
              aria-label="Apply all corrections for the page"
              ${totalIssues === 0 ? 'disabled' : ''}
            >
              <img src="${fixAllIconUrl}" alt="" />
            </button>
            <button type="button" class="panel-action-btn settings-btn" title="Open settings" aria-label="Open settings">
              <img src="${settingsIconUrl}" alt="" />
            </button>
          </div>
        </header>
        <section class="panel__content">
          ${hasGroups ? this.renderIssueGroups(groups, fixAllIconUrl) : this.renderEmptyState()}
        </section>
      </div>
    `;

    this.reconcilePreviewState();
  }

  private renderIssueSummary(totalIssues: number): string {
    return `<span class="issue__badge issue__count">${totalIssues}</span>`;
  }

  private renderIssueGroups(groups: IssueElementGroup[], fixAllIconUrl: string): string {
    return groups
      .map((group) => {
        const heading = describeGroupHeading(group) || 'Current field';
        const escapedHeading = this.escapeHtml(heading);
        const fixAllLabel = this.escapeHtml(`Apply all corrections for ${heading}`);
        const header = `<h2 class="group__title">${escapedHeading}</h2>`;
        const cards = group.issues.map((issue) => this.renderIssueCard(group, issue)).join('');
        const notices = group.errors ? this.renderGroupMessages(group.errors) : '';
        const issuesContent =
          group.issues.length > 0 ? `<div class="group__issues">${cards}</div>` : '';
        return `
          <article class="group" data-element-id="${group.elementId}">
            <div class="group__header">
              ${header}
              <button
                type="button"
                class="group__fix-all-btn"
                data-element-id="${group.elementId}"
                title="${fixAllLabel}"
                aria-label="${fixAllLabel}"
                ${group.issues.length === 0 ? 'disabled' : ''}
              >
                <img src="${fixAllIconUrl}" alt="" />
                <span>Apply all</span>
              </button>
            </div>
            ${notices}
            ${issuesContent}
          </article>
        `;
      })
      .join('');
  }

  private renderGroupMessages(errors: IssueGroupError[]): string {
    return errors.map((error) => this.renderGroupMessage(error)).join('');
  }

  private renderGroupMessage(error: IssueGroupError): string {
    const message = this.escapeHtml(error.message);
    const variant = error.severity === 'warning' ? 'warning' : 'error';
    const title = error.severity === 'warning' ? 'Proofreading warning' : 'Proofreading error';
    return `
      <div class="group__notice group__notice--${variant}" role="alert">
        <strong>${this.escapeHtml(title)}</strong>
        <p>${message}</p>
      </div>
    `;
  }

  private renderIssueCard(group: IssueElementGroup, issue: SidepanelIssue): string {
    const colors = getCorrectionTypeColor(issue.type);
    const original = this.escapeHtml(issue.originalText || '(empty)');
    const replacement = this.escapeHtml(issue.replacementText || '(empty)');
    const explanation = issue.explanation
      ? `<p class="issue__explanation">${this.escapeHtml(issue.explanation)}</p>`
      : '';
    const actionLabel = `Apply ${colors.label.toLowerCase()} correction`;

    return `
      <div
        class="issue"
        tabindex="0"
        role="button"
        aria-label="${this.escapeHtml(actionLabel)}"
        data-issue-id="${issue.id}"
        data-element-id="${group.elementId}"
        style="--issue-accent:${colors.color}"
      >
        <div class="issue__badge" style="background:${colors.background}; color:${colors.color}; border-color:${colors.border};">
          ${this.escapeHtml(colors.label)}
        </div>
        <div class="issue__content">
          <div class="issue__text">
            <span class="issue__original">${original}</span>
            <span class="issue__arrow">→</span>
            <span class="issue__replacement">${replacement}</span>
          </div>
          ${explanation}
        </div>
        <button
          type="button"
          class="apply-btn"
          tabindex="-1"
          data-issue-id="${issue.id}"
          data-element-id="${group.elementId}"
        >
          Apply
        </button>
      </div>
    `;
  }

  private renderEmptyState(): string {
    return `
      <div class="empty">
        <p>${this.escapeHtml(EMPTY_STATE_MESSAGE)}</p>
      </div>
    `;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private getStyles(): string {
    return `
      :host {
        display: block;
        font-family: var(--font-family-base);
        color: var(--color-text-primary);
        min-height: 100%;
      }

      .panel {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-md);
      }

      .panel__header-left {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .panel__header-right {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-sm);
      }

      .panel__header h1 {
        margin: 0;
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
      }

      .panel__status {
        font-size: var(--font-size-sm);
        color: var(--color-primary);
        font-weight: var(--font-weight-medium);
      }

      .panel-action-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-xl);
        border: 1px solid var(--color-border);
        background: var(--color-surface-subtle);
        color: var(--color-text-secondary);
        width: 2rem;
        height: 2rem;
        cursor: pointer;
        transition: background var(--transition-base), color var(--transition-base), border-color var(--transition-base), box-shadow var(--transition-base);
        padding: 0;
      }

      .panel-action-btn:hover,
      .panel-action-btn:focus-visible {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-primary-ring);
      }

      .panel-action-btn[disabled] {
        cursor: not-allowed;
        opacity: 0.55;
        box-shadow: none;
        border-color: var(--color-border);
      }

      .panel-action-btn img {
        width: 1.1rem;
        height: 1.1rem;
        display: block;
      }

      .fix-all-btn img {
        color: var(--color-success-text);
      }

      .fix-all-btn img {
        color: var(--color-success-text);
      }

      .panel__status--idle {
        color: var(--color-text-tertiary);
      }

      .panel__content {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        padding: var(--spacing-md);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        box-shadow: var(--shadow-sm);
      }

      .group__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-sm);
      }

      .group__title {
        margin: 0;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-secondary);
        flex: 1;
      }

      .group__fix-all-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-border);
        background: var(--color-surface-subtle);
        color: var(--color-text-secondary);
        padding: 0.4rem 0.6rem;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: background var(--transition-base), color var(--transition-base), border-color var(--transition-base), box-shadow var(--transition-base);
      }

      .group__fix-all-btn:hover,
      .group__fix-all-btn:focus-visible {
        border-color: var(--color-primary);
        color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-primary-ring);
      }

      .group__fix-all-btn[disabled] {
        cursor: not-allowed;
        opacity: 0.6;
        border-color: var(--color-border);
        color: var(--color-text-tertiary);
        box-shadow: none;
      }

      .group__fix-all-btn img {
        width: 1.2rem;
        height: 1.2rem;
      }

      .group__issues {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .group__notice {
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
        background: var(--color-surface-subtle);
        color: var(--color-text-secondary);
        padding: var(--spacing-sm);
        font-size: var(--font-size-sm);
        line-height: var(--line-height-base);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2xs);
      }

      .group__notice strong {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
      }

      .group__notice p {
        margin: 0;
      }

      .group__notice--warning {
        border-color: var(--color-warning-border);
        background: var(--color-warning-surface);
        color: var(--color-warning-text);
      }

      .group__notice--error {
        border-color: rgba(207, 66, 66, 0.4);
        background: rgba(207, 66, 66, 0.08);
        color: var(--color-proofly-red);
      }

      .issue {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: var(--spacing-sm);
        align-items: center;
        padding: var(--spacing-sm);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
        background: var(--color-surface-subtle);
        cursor: pointer;
        transition: border-color var(--transition-base), box-shadow var(--transition-base);
        outline: none;
      }

      .issue:hover,
      .issue:focus-visible {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px var(--color-primary-ring);
      }

      .issue__badge {
        padding: 0.25rem 0.5rem;
        border-radius: 999px;
        font-size: var(--font-size-xs);
        border-width: 1px;
        border-style: solid;
      }
      
      .issue__badge.issue__count {
        background: var(--color-proofly-red);
        color: var(--color-text-inverse);
      }

      .issue__content {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2xs);
      }

      .issue__text {
        display: inline-flex;
        gap: var(--spacing-xs);
        align-items: center;
        font-size: var(--font-size-sm);
      }

      .issue__original {
        text-decoration: line-through;
        text-decoration-thickness: 1px;
      }

      .issue__replacement {
        font-weight: var(--font-weight-semibold);
      }

      .issue__arrow {
        color: var(--color-text-tertiary);
      }

      .issue__explanation {
        margin: 0;
        font-size: var(--font-size-xs);
        color: var(--color-text-tertiary);
      }

      .apply-btn {
        padding: 0.4rem 0.75rem;
        border-radius: var(--radius-sm);
        border: 1px solid var(--color-primary);
        background: var(--color-primary);
        color: var(--color-on-primary);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: background var(--transition-base), border-color var(--transition-base);
      }

      .apply-btn:hover {
        background: var(--color-primary-hover);
        border-color: var(--color-primary-hover);
      }

      .apply-btn:active {
        background: var(--color-primary-active);
        border-color: var(--color-primary-active);
      }
      
      .fix-all-btn img {
        color: var(--color-success-text);        
      }

      .empty {
        display: flex;
        justify-content: center;
        align-items: center;
        text-align: center;
        padding: var(--spacing-lg);
        color: var(--color-text-tertiary);
        background: var(--color-surface);
        border-radius: var(--radius-md);
        border: 1px dashed var(--color-border);
      }

      .empty p {
        margin: 0;
        font-size: var(--font-size-sm);
      }
    `;
  }
}

customElements.define('prfly-issues-panel', ProoflyIssuesPanel);

function describeKind(kind: IssueElementKind | null): string {
  if (!kind) {
    return 'Current field';
  }

  switch (kind) {
    case 'input':
      return 'Input field';
    case 'textarea':
      return 'Textarea';
    case 'contenteditable':
      return 'Content area';
    default:
      return 'Current field';
  }
}

function describeGroupHeading(group: IssueElementGroup): string {
  if (group.label) {
    return group.label;
  }
  if (group.domId) {
    return group.domId;
  }
  return describeKind(group.kind);
}
