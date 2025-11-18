import type { IssueElementKind } from '../messages/issues.ts';

export type ProofreadLifecycleStatus =
  | 'queued'
  | 'throttled'
  | 'language-detected'
  | 'start'
  | 'complete'
  | 'ignored'
  | 'error'
  | 'abort';

export type ProofreadLifecycleReason =
  | 'unsupported-target'
  | 'spellcheck-disabled'
  | 'empty-text'
  | 'unchanged-text'
  | 'restored-from-history'
  | 'applying-correction'
  | 'restoring-from-history'
  | 'missing-state';

export interface ProofreadControlEventDetail {
  status: ProofreadLifecycleStatus;
  executionId: string;
  elementId: string;
  elementKind: IssueElementKind;
  textLength: number;
  correctionCount?: number;
  detectedIssueCount?: number;
  reason?: ProofreadLifecycleReason;
  error?: string;
  queueLength?: number;
  debounceMs?: number;
  forced?: boolean;
  language?: string | null;
  fallbackLanguage?: string;
  timestamp: number;
}

export const PROOFREAD_CONTROL_EVENT = 'proofly:proofread-control';
export const PROOFREAD_CONTROL_CHANNEL = 'proofly-proofread-control';

const broadcastChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(PROOFREAD_CONTROL_CHANNEL) : null;

export function emitProofreadControlEvent(detail: ProofreadControlEventDetail): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROOFREAD_CONTROL_EVENT, { detail }));
  }

  try {
    broadcastChannel?.postMessage(detail);
  } catch {
    // ignored – broadcast channel unavailable
  }

  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
  if (!runtime?.sendMessage) {
    return;
  }

  try {
    void runtime.sendMessage({ type: 'proofly:proofread-control', payload: detail });
  } catch {
    // ignored – runtime not ready
  }
}
