import type { DevOpenSidepanelMessage } from '../shared/messages/issues.ts';
import { logger } from '../services/logger.ts';
import { serializeError } from '../shared/utils/serialize.ts';
import PanelOpenedInfo = chrome.sidePanel.PanelOpenedInfo;

const openSidepanelTabs = new Set<number>();

chrome.sidePanel.onOpened.addListener((info: PanelOpenedInfo) => {
  openSidepanelTabs.add(Number(info.tabId));
});

export function getSenderOrPayloadTabId(
  sender: chrome.runtime.MessageSender,
  explicitTabId?: number | null
): number | null {
  if (typeof sender.tab?.id === 'number' && sender.tab.id !== chrome.tabs.TAB_ID_NONE) {
    return sender.tab.id;
  }

  if (typeof explicitTabId === 'number' && explicitTabId !== chrome.tabs.TAB_ID_NONE) {
    return explicitTabId;
  }

  return null;
}

type SidepanelCloseFunction = (options: { tabId: number }) => Promise<void>;

export function getSidepanelCloseFunction(): SidepanelCloseFunction | null {
  const maybeClose = (
    chrome.sidePanel as typeof chrome.sidePanel & {
      close?: SidepanelCloseFunction;
    }
  ).close;

  if (typeof maybeClose === 'function') {
    return maybeClose;
  }

  return null;
}

export function handleSidepanelToggleEvent(
  sendResponse: (response?: any) => void,
  sender: chrome.runtime.MessageSender,
  message: DevOpenSidepanelMessage
) {
  if (!chrome?.sidePanel?.setOptions || !chrome.sidePanel.open) {
    sendResponse({ success: false, reason: 'unsupported' });
    return false;
  }

  const tabId = getSenderOrPayloadTabId(sender, message.payload?.tabId);

  if (tabId === null) {
    sendResponse({ success: false, reason: 'missing-tab' });
    return false;
  }

  const requestedAction = message.payload?.action ?? 'open';
  const action =
    requestedAction === 'toggle'
      ? openSidepanelTabs.has(tabId)
        ? 'close'
        : 'open'
      : requestedAction;

  if (action === 'close') {
    const closeFn = getSidepanelCloseFunction();

    if (!closeFn) {
      sendResponse({ success: false, reason: 'close-unsupported' });
      return false;
    }

    closeFn({ tabId })
      .then(() => {
        openSidepanelTabs.delete(tabId);
        sendResponse({ success: true });
      })
      .catch((error) => {
        openSidepanelTabs.delete(tabId);
        logger.error(
          { error: serializeError(error), tabId },
          'Failed to close sidepanel from dev helper'
        );
        sendResponse({ success: false, reason: 'close-failed' });
      });

    return true;
  }

  chrome.sidePanel
    .setOptions({
      tabId,
      path: 'src/sidepanel/index.html',
      enabled: true,
    })
    .catch((error) => {
      logger.warn(
        { error: serializeError(error), tabId },
        'Failed to prepare sidepanel options from dev helper'
      );
    });

  chrome.sidePanel
    .open({ tabId })
    .then(() => {
      openSidepanelTabs.add(tabId);
      sendResponse({ success: true });
    })
    .catch((error) => {
      openSidepanelTabs.delete(tabId);
      logger.error(
        { error: serializeError(error), tabId },
        'Failed to open sidepanel from dev helper'
      );
      sendResponse({ success: false, reason: 'open-failed' });
    });

  return true;
}
