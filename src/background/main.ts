import { STORAGE_KEYS } from '../shared/constants.ts';
import { initializeStorage, onStorageChange } from '../shared/utils/storage.ts';
import { logger } from '../services/logger.ts';
import { handleProofreadRequest, resetProofreaderServices } from './proofreader-proxy.ts';

import type {
  IssuesUpdatePayload,
  IssuesUpdateMessage,
  IssuesStateRequestMessage,
  IssuesStateResponseMessage,
  ProoflyMessage,
  ProofreaderStateMessage,
  ProofreadRequestMessage,
  ProofreaderBusyStateRequestMessage,
  ProofreaderBusyStateResponseMessage,
} from '../shared/messages/issues.ts';
import { serializeError } from '../shared/utils/serialize.ts';
import { handleSidepanelToggleEvent } from './sidepanel-button-handler.ts';

let badgeListenersRegistered = false;
let currentBadgeState: 'ready' | 'clear' | 'count' | null = null;
interface TabIssuesState {
  payload: IssuesUpdatePayload | null;
  revision: number;
}

const issuesByTab = new Map<number, TabIssuesState>();
const badgeUpdateQueues = new Map<number, Promise<void>>();
const busyTabs = new Set<number>();
const BUSY_BADGE_COLOR = '#facc15';
const BUSY_TEXT_COLOR = '#000000';
const DEFAULT_BADGE_COLOR = '#dc2626';
const DEFAULT_TEXT_COLOR = '#ffffff';
const CLEAR_BADGE_COLOR = 'transparent';

function applyBusyBadge(tabId: number, text: string): void {
  chrome.action
    .setBadgeBackgroundColor({ color: BUSY_BADGE_COLOR, tabId })
    .catch((error) =>
      logger.warn({ error: serializeError(error), tabId }, 'Failed to set busy badge color')
    );

  if ('setBadgeTextColor' in chrome.action) {
    chrome.action
      .setBadgeTextColor({ color: BUSY_TEXT_COLOR, tabId })
      .catch((error) =>
        logger.warn({ error: serializeError(error), tabId }, 'Failed to set busy badge text color')
      );
  }

  chrome.action
    .setBadgeText({ text, tabId })
    .catch((error) =>
      logger.warn({ error: serializeError(error), tabId }, 'Failed to set busy badge text')
    );
}

function countIssues(state: TabIssuesState | null | undefined): number {
  if (!state?.payload) {
    return 0;
  }
  return state.payload.elements.reduce((total, group) => total + group.issues.length, 0);
}

function enqueueBadgeUpdate(tabId: number, payloadState: TabIssuesState | null): void {
  const queue = badgeUpdateQueues.get(tabId) ?? Promise.resolve();
  const next = queue
    .catch((error) => {
      logger.warn(
        { error: serializeError(error), tabId },
        'Previous badge update failed, continuing'
      );
    })
    .then(async () => {
      await applyBadgeUpdate(tabId, payloadState);
    })
    .catch((error) => {
      logger.error({ error: serializeError(error), tabId }, 'Badge update failed');
    });

  badgeUpdateQueues.set(tabId, next);
}

async function applyBadgeUpdate(tabId: number, payloadState: TabIssuesState | null): Promise<void> {
  const latestState = issuesByTab.get(tabId) ?? null;
  const activeState = payloadState ?? latestState;

  if (payloadState && latestState && payloadState !== latestState) {
    if (payloadState.revision < latestState.revision) {
      logger.info(
        {
          tabId,
          revision: payloadState.revision,
          latestRevision: latestState.revision,
        },
        'Skipping stale badge update'
      );
      return;
    }
  }

  if (!payloadState && latestState) {
    logger.info(
      { tabId, latestRevision: latestState.revision },
      'Skipping badge clear because newer issues exist'
    );
    return;
  }

  const totalIssues = countIssues(activeState);
  logger.info(
    { tabId, totalIssues, revision: activeState?.revision ?? null },
    'Updating badge for issues'
  );
  try {
    await chrome.storage.local.set({
      __debug_last_badge_state: { tabId, totalIssues, updatedAt: Date.now() },
    });
  } catch (error) {
    logger.warn({ error: serializeError(error), tabId }, 'Failed to persist debug badge state');
  }
  const busyText = totalIssues > 0 ? (totalIssues > 99 ? '99+' : String(totalIssues)) : ' ';
  const idleText = totalIssues > 0 ? (totalIssues > 99 ? '99+' : String(totalIssues)) : '';

  if (busyTabs.has(tabId)) {
    await chrome.action
      .setBadgeText({ text: busyText, tabId })
      .catch((error) =>
        logger.warn(
          { error: serializeError(error), tabId },
          'Failed to update badge text while busy'
        )
      );
    return;
  }

  if (totalIssues > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: DEFAULT_BADGE_COLOR, tabId });
    if ('setBadgeTextColor' in chrome.action) {
      await chrome.action.setBadgeTextColor({ color: DEFAULT_TEXT_COLOR, tabId }).catch((error) => {
        logger.warn({ error: serializeError(error), tabId }, 'Failed to restore badge text color');
      });
    }
    await chrome.action.setBadgeText({ text: idleText, tabId });
    currentBadgeState = 'count';
    return;
  }

  await chrome.action.setBadgeBackgroundColor({ color: CLEAR_BADGE_COLOR, tabId }).catch(() => {});
  await chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  currentBadgeState = 'clear';
}

function handleIssuesUpdate(
  message: IssuesUpdateMessage,
  sender: chrome.runtime.MessageSender
): void {
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') {
    return;
  }

  const tabUrl = sender.tab?.url ?? '';
  const isOptionsPage = tabUrl.includes('/src/options/index.html');
  if (tabUrl.startsWith('chrome-extension://') && !isOptionsPage) {
    logger.info({ tabId, tabUrl }, 'Ignoring issues update from extension page');
    return;
  }

  const incomingRevision = message.payload.revision ?? 0;
  const existingState = issuesByTab.get(tabId);
  const currentRevision = existingState?.revision ?? 0;

  if (incomingRevision < currentRevision) {
    logger.info(
      { tabId, incomingRevision, currentRevision },
      'Ignoring out-of-order issues update'
    );
    return;
  }

  const clonedPayload = structuredClone(message.payload);
  const state: TabIssuesState = { payload: clonedPayload, revision: incomingRevision };
  issuesByTab.set(tabId, state);

  try {
    chrome.storage.local.set({ __debug_last_payload: clonedPayload });
  } catch (error) {
    logger.warn({ error: serializeError(error), tabId }, 'Failed to store debug payload');
  }

  enqueueBadgeUpdate(tabId, state);
}

function handleIssuesStateRequest(
  message: IssuesStateRequestMessage,
  sendResponse: (response: IssuesStateResponseMessage) => void
): void {
  const state = issuesByTab.get(message.payload.tabId) ?? null;
  sendResponse({ type: 'proofly:issues-state', payload: state?.payload ?? null });
}

function handleProofreaderBusyStateRequest(
  message: ProofreaderBusyStateRequestMessage,
  sendResponse: (response: ProofreaderBusyStateResponseMessage) => void
): void {
  const busy = busyTabs.has(message.payload.tabId);
  sendResponse({ type: 'proofly:proofreader-busy-state', payload: { busy } });
}

function handleProofreaderStateMessage(
  message: ProofreaderStateMessage,
  sender: chrome.runtime.MessageSender
): void {
  logger.info({ message, sender }, 'Handling proofreader state message');

  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') {
    return;
  }

  const tabUrl = sender.tab?.url ?? '';
  const isOptionsPage = tabUrl.includes('/src/options/index.html');
  if (tabUrl.startsWith('chrome-extension://') && !isOptionsPage) {
    logger.info({ tabId, tabUrl }, 'Ignoring proofreader state from extension page');
    return;
  }

  if (message.payload.busy) {
    busyTabs.add(tabId);
    const state = issuesByTab.get(tabId) ?? null;
    const totalIssues = countIssues(state);
    const text = totalIssues > 0 ? (totalIssues > 99 ? '99+' : String(totalIssues)) : ' ';

    applyBusyBadge(tabId, text);
    setTimeout(() => {
      if (busyTabs.has(tabId)) {
        const latestState = issuesByTab.get(tabId) ?? null;
        const latestTotal = countIssues(latestState);
        const latestText = latestTotal > 0 ? (latestTotal > 99 ? '99+' : String(latestTotal)) : ' ';
        applyBusyBadge(tabId, latestText);
      }
    }, 120);

    void chrome.runtime.sendMessage({
      type: 'proofly:proofreader-state-update',
      payload: { tabId, busy: true },
    });
    return;
  }

  busyTabs.delete(tabId);

  void chrome.runtime.sendMessage({
    type: 'proofly:proofreader-state-update',
    payload: { tabId, busy: false },
  });
}

async function updateActionBadge(): Promise<void> {
  try {
    if (currentBadgeState === 'clear') {
      return;
    }

    await chrome.action.setBadgeText({ text: '' });
    logger.info('Extension badge cleared');
    currentBadgeState = 'clear';
  } catch (error) {
    logger.error({ error: serializeError(error) }, 'Failed to update badge');
  }
}

function registerBadgeListeners(): void {
  if (badgeListenersRegistered) {
    return;
  }

  onStorageChange(STORAGE_KEYS.MODEL_DOWNLOADED, () => {
    void updateActionBadge();
  });

  onStorageChange(STORAGE_KEYS.PROOFREADER_READY, () => {
    void updateActionBadge();
  });

  badgeListenersRegistered = true;
}

registerBadgeListeners();
void updateActionBadge();

chrome.runtime.onInstalled.addListener(async (details) => {
  await initializeStorage();
  logger.info({ reason: details?.reason }, 'Proofly extension installed and storage initialized');

  chrome.contextMenus.create({
    id: 'proofly-check',
    title: 'Proofread with Proofly',
    contexts: ['selection', 'editable'],
  });

  registerBadgeListeners();
  await updateActionBadge();

  if (details?.reason === 'install') {
    try {
      await chrome.runtime.openOptionsPage();
      logger.info('Options page opened after install');
    } catch (error) {
      logger.error({ error }, 'Failed to open options page after install');
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeStorage();
  logger.info('Proofly extension started');

  registerBadgeListeners();
  await updateActionBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'proofly-check' && tab?.id) {
    await chrome.tabs.sendMessage(tab.id, { type: 'proofread-selection' });
  }
});

chrome.runtime.onMessage.addListener((message: ProoflyMessage, sender, sendResponse) => {
  if (message.type === 'proofly:issues-update') {
    handleIssuesUpdate(message, sender);
    return false;
  }

  if (message.type === 'proofly:proofreader-state') {
    handleProofreaderStateMessage(message, sender);
    return false;
  }

  if (message.type === 'proofly:get-issues-state') {
    handleIssuesStateRequest(message, sendResponse);
    return true;
  }

  if (message.type === 'proofly:get-proofreader-busy-state') {
    handleProofreaderBusyStateRequest(message, sendResponse);
    return true;
  }

  if (message.type === 'proofly:clear-badge') {
    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      void chrome.action.setBadgeText({ text: ' ', tabId }).catch((error) => {
        logger.warn({ error: serializeError(error), tabId }, 'Failed to clear badge via request');
      });
      currentBadgeState = 'clear';
    }
    return false;
  }

  if (message.type === 'proofly:proofread-request') {
    handleProofreadRequest(message as ProofreadRequestMessage)
      .then((response) => sendResponse(response))
      .catch((error) => {
        logger.error(
          { error: serializeError(error), requestId: message.payload?.requestId },
          'Unhandled error while proxying proofread request'
        );
        sendResponse({
          requestId: (message as ProofreadRequestMessage).payload.requestId,
          ok: false,
          error: {
            code: 'unknown',
            message:
              error instanceof Error
                ? error.message
                : typeof error === 'string'
                  ? error
                  : 'Proofread request failed',
            name: error instanceof Error ? error.name : undefined,
          },
        });
      });
    return true;
  }

  if (message.type === 'proofly:open-sidepanel-dev') {
    return handleSidepanelToggleEvent(sendResponse, sender, message);
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  issuesByTab.delete(tabId);
  busyTabs.delete(tabId);
  enqueueBadgeUpdate(tabId, null);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    issuesByTab.delete(tabId);
    busyTabs.delete(tabId);
    enqueueBadgeUpdate(tabId, null);
  }
});

if ('setPanelBehavior' in chrome.sidePanel) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || tab.id === chrome.tabs.TAB_ID_NONE) {
    return;
  }
});

if ('onSuspend' in chrome.runtime) {
  chrome.runtime.onSuspend.addListener(() => {
    resetProofreaderServices();
  });
}
