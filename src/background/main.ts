import { STORAGE_KEYS } from '../shared/constants.ts';
import { initializeStorage, onStorageChange } from '../shared/utils/storage.ts';
import { logger } from '../services/logger.ts';
import type {
  IssuesUpdatePayload,
  IssuesUpdateMessage,
  IssuesStateRequestMessage,
  IssuesStateResponseMessage,
  ProoflyMessage,
} from '../shared/messages/issues.ts';

let badgeListenersRegistered = false;
let currentBadgeState: 'ready' | 'clear' | null = null;
const issuesByTab = new Map<number, IssuesUpdatePayload>();

function countIssues(payload: IssuesUpdatePayload | null | undefined): number {
  if (!payload) {
    return 0;
  }
  return payload.elements.reduce((total, group) => total + group.issues.length, 0);
}

async function updateBadgeForIssues(tabId: number, payload: IssuesUpdatePayload | null): Promise<void> {
  const totalIssues = countIssues(payload);

  if (totalIssues > 0) {
    const text = totalIssues > 99 ? '99+' : String(totalIssues);
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId });
    if ('setBadgeTextColor' in chrome.action) {
      await chrome.action.setBadgeTextColor({ color: '#ffffff', tabId });
    }
    await chrome.action.setBadgeText({ text, tabId });
    return;
  }
}

function handleIssuesUpdate(message: IssuesUpdateMessage, sender: chrome.runtime.MessageSender): void {
  const tabId = sender.tab?.id;
  if (typeof tabId !== 'number') {
    return;
  }

  issuesByTab.set(tabId, structuredClone(message.payload));
  void updateBadgeForIssues(tabId, message.payload).catch((error) => {
    logger.error({ error, tabId }, 'Failed to update badge for issues');
  });
}

function handleIssuesStateRequest(
  message: IssuesStateRequestMessage,
  sendResponse: (response: IssuesStateResponseMessage) => void
): void {
  const payload = issuesByTab.get(message.payload.tabId) ?? null;
  sendResponse({ type: 'proofly:issues-state', payload });
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
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error({ err }, 'Failed to update badge');
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

chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
  logger.info('Proofly extension installed and storage initialized');

  chrome.contextMenus.create({
    id: 'proofly-check',
    title: 'Proofread with Proofly',
    contexts: ['selection', 'editable'],
  });

  registerBadgeListeners();
  await updateActionBadge();
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

  if (message.type === 'proofly:get-issues-state') {
    handleIssuesStateRequest(message, sendResponse);
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  issuesByTab.delete(tabId);
  void updateBadgeForIssues(tabId, null).catch((error) => {
    logger.error({ error, tabId }, 'Failed to reset badge on tab removal');
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    issuesByTab.delete(tabId);
    void updateBadgeForIssues(tabId, null).catch((error) => {
      logger.error({ error, tabId }, 'Failed to reset badge on navigation');
    });
  }
});

if ('setPanelBehavior' in chrome.sidePanel) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || tab.id === chrome.tabs.TAB_ID_NONE) {
    return;
  }

  try {
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'src/sidepanel/index.html',
      enabled: true,
    });
    logger.info({ tabId: tab.id }, 'Side panel prepared for action click');
  } catch (error) {
    logger.error({ error, tabId: tab.id }, 'Failed to configure side panel');
  }
});
