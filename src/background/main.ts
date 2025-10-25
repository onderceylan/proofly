import { STORAGE_KEYS } from '../shared/constants.ts';
import { initializeStorage, isModelReady, onStorageChange } from '../shared/utils/storage.ts';
import { logger } from "../services/logger.ts";

let badgeListenersRegistered = false;
let currentBadgeState: 'ready' | 'clear' | null = null;

async function updateActionBadge(): Promise<void> {
  try {
    const ready = await isModelReady();

    if (ready) {
      if (currentBadgeState === 'ready') {
        return;
      }

      await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
      if ('setBadgeTextColor' in chrome.action) {
        await chrome.action.setBadgeTextColor({ color: '#ffffff' });
      }
      await chrome.action.setBadgeText({ text: ' ' });
      logger.info('Extension badge set to ready state');
      currentBadgeState = 'ready';
      return;
    }

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
    title: 'Check with Proofly',
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
