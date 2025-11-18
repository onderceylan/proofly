import type { CorrectionType, ProofreadCorrection, ProofreadResult } from '../types.ts';

export type IssueElementKind = 'input' | 'textarea' | 'contenteditable';

export interface SidepanelIssue {
  id: string;
  elementId: string;
  originalText: string;
  replacementText: string;
  startIndex: number;
  endIndex: number;
  type?: CorrectionType;
  explanation?: string;
}

export type IssueGroupErrorCode =
  | 'unsupported-language'
  | 'language-detection-unconfident'
  | 'language-detection-error';

export type IssueGroupErrorSeverity = 'error' | 'warning';

export interface IssueGroupError {
  code: IssueGroupErrorCode;
  severity: IssueGroupErrorSeverity;
  message: string;
  details?: {
    language?: string;
    supportedLanguages?: string[];
  };
}

export type ProofreadServiceErrorCode =
  | 'unsupported-language'
  | 'unavailable'
  | 'unknown'
  | 'cancelled';

export interface ProofreadServiceError {
  code: ProofreadServiceErrorCode;
  message: string;
  name?: string;
  data?: Record<string, unknown>;
}

export interface ProofreadRequestMessage {
  type: 'proofly:proofread-request';
  payload: {
    requestId: string;
    text: string;
    language: string;
    fallbackLanguage: string;
  };
}

export interface ProofreadResponseSuccess {
  requestId: string;
  ok: true;
  result: ProofreadResult;
}

export interface ProofreadResponseFailure {
  requestId: string;
  ok: false;
  error: ProofreadServiceError;
}

export type ProofreadResponse = ProofreadResponseSuccess | ProofreadResponseFailure;

export interface IssueElementGroup {
  elementId: string;
  domId: string | null;
  kind: IssueElementKind;
  label: string | null;
  issues: SidepanelIssue[];
  errors?: IssueGroupError[] | null;
}

export interface IssuesUpdatePayload {
  pageId: string;
  activeElementId: string | null;
  activeElementLabel: string | null;
  activeElementKind: IssueElementKind | null;
  elements: IssueElementGroup[];
  revision?: number;
}

export interface IssuesUpdateMessage {
  type: 'proofly:issues-update';
  payload: IssuesUpdatePayload;
}

export interface ApplyIssueMessage {
  type: 'proofly:apply-issue';
  payload: {
    elementId: string;
    issueId: string;
  };
}

export interface ApplyAllIssuesMessage {
  type: 'proofly:apply-all-issues';
}

export interface ProofreaderStateMessage {
  type: 'proofly:proofreader-state';
  payload: {
    busy: boolean;
  };
}

export interface ProofreaderStateUpdateMessage {
  type: 'proofly:proofreader-state-update';
  payload: {
    tabId: number;
    busy: boolean;
  };
}

export interface IssuesStateRequestMessage {
  type: 'proofly:get-issues-state';
  payload: {
    tabId: number;
  };
}

export interface IssuesStateResponseMessage {
  type: 'proofly:issues-state';
  payload: IssuesUpdatePayload | null;
}

export interface ClearBadgeMessage {
  type: 'proofly:clear-badge';
}

export interface ProofreaderBusyStateRequestMessage {
  type: 'proofly:get-proofreader-busy-state';
  payload: {
    tabId: number;
  };
}

export interface ProofreaderBusyStateResponseMessage {
  type: 'proofly:proofreader-busy-state';
  payload: {
    busy: boolean;
  };
}

export interface DevOpenSidepanelMessage {
  type: 'proofly:open-sidepanel-dev';
  payload?: {
    tabId?: number | null;
    action?: 'open' | 'close' | 'toggle';
  };
}

export type ProoflyMessage =
  | IssuesUpdateMessage
  | ApplyIssueMessage
  | ApplyAllIssuesMessage
  | ProofreaderStateMessage
  | ProofreaderStateUpdateMessage
  | IssuesStateRequestMessage
  | IssuesStateResponseMessage
  | ClearBadgeMessage
  | ProofreadRequestMessage
  | ProofreaderBusyStateRequestMessage
  | ProofreaderBusyStateResponseMessage
  | DevOpenSidepanelMessage;

export function toSidepanelIssue(
  elementId: string,
  correction: ProofreadCorrection,
  originalText: string,
  id: string
): SidepanelIssue {
  return {
    id,
    elementId,
    originalText,
    replacementText: correction.correction,
    startIndex: correction.startIndex,
    endIndex: correction.endIndex,
    type: correction.type,
    explanation: correction.explanation,
  };
}

export function normalizeIssueLabel(element: HTMLElement): string | null {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    const labels = element.labels;
    if (labels) {
      for (const label of labels) {
        const text = label.textContent?.trim();
        if (text) {
          return text;
        }
      }
    }
  }

  const ariaLabelledBy = element.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const ids = ariaLabelledBy.split(/\s+/).filter(Boolean);
    const parts: string[] = [];
    const doc = element.ownerDocument;
    for (const id of ids) {
      const labelElement = doc ? doc.getElementById(id) : null;
      const text = labelElement?.textContent?.trim();
      if (text) {
        parts.push(text);
      }
    }
    if (parts.length > 0) {
      return parts.join(' ');
    }
  }

  const ariaLabel = element.getAttribute('aria-label')?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }

  const closestLabel = element.closest('label');
  const closestLabelText = closestLabel?.textContent?.trim();
  if (closestLabelText) {
    return closestLabelText;
  }

  return null;
}

export function resolveElementKind(element: HTMLElement): IssueElementKind {
  const tag = element.tagName.toLowerCase();
  if (tag === 'textarea') {
    return 'textarea';
  }
  if (tag === 'input') {
    return 'input';
  }
  return 'contenteditable';
}
