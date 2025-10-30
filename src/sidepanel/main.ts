import '../shared/components/model-downloader.ts';
import './components/issues-panel.ts';
import './style.css';

import { logger } from '../services/logger.ts';
import { isModelReady } from '../shared/utils/storage.ts';
import type {
  IssuesStateRequestMessage,
  IssuesStateResponseMessage,
  IssuesUpdateMessage,
  IssuesUpdatePayload,
  ProoflyMessage,
} from '../shared/messages/issues.ts';
import { ProoflyIssuesPanel } from './components/issues-panel.ts';
import { ensureProofreaderModelReady } from '../services/model-checker.ts';

type ApplyIssueDetail = { elementId: string; issueId: string };

let panelElement: ProoflyIssuesPanel | null = null;
let appContainer: HTMLDivElement | null = null;
let activeTabId: number | null = null;
let currentWindowId: number | undefined;
let messageListenerRegistered = false;
let tabActivationListenerRegistered = false;
let tabRemovalListenerRegistered = false;

function updatePanelState(payload: IssuesUpdatePayload | null): void {
  const normalizedPayload = payload
    ? {
        ...payload,
        activeElementId: null,
        activeElementLabel: null,
        activeElementKind: null,
      }
    : null;

  panelElement?.setState(normalizedPayload);
}

async function initSidepanel(): Promise<void> {
  appContainer = document.querySelector<HTMLDivElement>('#app');
  if (!appContainer) {
    logger.error('Sidepanel root element not found');
    return;
  }

  document.body.classList.add('prfly-page');

  await ensureProofreaderModelReady();

  const modelReady = await isModelReady();
  if (!modelReady) {
    renderModelDownloader();
    return;
  }

  mountIssuesPanel();
  registerRuntimeListeners();
  await refreshActiveTab();
}

function renderModelDownloader(): void {
  if (!appContainer) {
    return;
  }

  appContainer.innerHTML = `
    <div class="prfly-section prfly-section--muted prfly-stack">
      <proofly-model-downloader></proofly-model-downloader>
    </div>
  `;
  const downloader = appContainer.querySelector('proofly-model-downloader');
  downloader?.addEventListener('download-complete', () => {
    location.reload();
  });
}

function mountIssuesPanel(): void {
  if (!appContainer) {
    return;
  }

  panelElement = document.createElement('prfly-issues-panel') as ProoflyIssuesPanel;
  panelElement.addEventListener('apply-issue', onApplyIssue);

  const section = document.createElement('div');
  section.className = 'prfly-section prfly-section--muted';
  section.appendChild(panelElement);

  appContainer.innerHTML = '';
  appContainer.appendChild(section);
}

function registerRuntimeListeners(): void {
  if (!messageListenerRegistered) {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    messageListenerRegistered = true;
  }

  if (!tabActivationListenerRegistered) {
    chrome.tabs.onActivated.addListener(handleTabActivated);
    tabActivationListenerRegistered = true;
  }

  if (!tabRemovalListenerRegistered) {
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
    tabRemovalListenerRegistered = true;
  }
}

async function refreshActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab || tab.id === undefined) {
      activeTabId = null;
      currentWindowId = tab?.windowId;
      updatePanelState(null);
      logger.warn('No active tab found for sidepanel');
      return;
    }

    activeTabId = tab.id;
    currentWindowId = tab.windowId;
    await requestIssuesState(tab.id);
  } catch (error) {
    logger.error({ error }, 'Failed to resolve active tab for sidepanel');
    updatePanelState(null);
  }
}

function handleRuntimeMessage(
  message: ProoflyMessage,
  sender: chrome.runtime.MessageSender
): boolean {
  if (message.type === 'proofly:issues-update') {
    return handleIssuesUpdateMessage(message, sender);
  }

  return false;
}

function handleIssuesUpdateMessage(
  message: IssuesUpdateMessage,
  sender: chrome.runtime.MessageSender
): boolean {
  const senderTabId = sender.tab?.id;
  if (typeof senderTabId !== 'number') {
    return false;
  }

  if (activeTabId !== senderTabId) {
    return false;
  }

  updatePanelState(message.payload);
  return false;
}

async function handleTabActivated(activeInfo: { tabId: number; windowId: number }): Promise<void> {
  if (typeof activeInfo.tabId !== 'number') {
    return;
  }

  if (currentWindowId === undefined) {
    currentWindowId = activeInfo.windowId;
  }

  if (currentWindowId !== undefined && activeInfo.windowId !== currentWindowId) {
    return;
  }

  activeTabId = activeInfo.tabId;
  await requestIssuesState(activeInfo.tabId);
}

function handleTabRemoved(tabId: number): void {
  if (tabId === activeTabId) {
    activeTabId = null;
    updatePanelState(null);
  }
}

async function requestIssuesState(tabId: number): Promise<void> {
  try {
    const message: IssuesStateRequestMessage = {
      type: 'proofly:get-issues-state',
      payload: { tabId },
    };
    const response = (await chrome.runtime.sendMessage(message)) as IssuesStateResponseMessage;

    if (response?.type !== 'proofly:issues-state') {
      logger.warn({ tabId }, 'Unexpected response for issues state request');
      return;
    }

    updatePanelState(response.payload ?? null);
  } catch (error) {
    logger.error({ error, tabId }, 'Failed to request issues state');
  }
}

function onApplyIssue(event: Event): void {
  void handleApplyIssue(event as CustomEvent<ApplyIssueDetail>);
}

async function handleApplyIssue(event: CustomEvent<ApplyIssueDetail>): Promise<void> {
  if (!activeTabId) {
    logger.warn('Apply issue requested without an active tab');
    return;
  }

  try {
    await chrome.tabs.sendMessage(activeTabId, {
      type: 'proofly:apply-issue',
      payload: {
        elementId: event.detail.elementId,
        issueId: event.detail.issueId,
      },
    });
    logger.info(
      { elementId: event.detail.elementId, issueId: event.detail.issueId },
      'Apply issue dispatched'
    );
  } catch (error) {
    logger.error(
      {
        error,
        elementId: event.detail.elementId,
        issueId: event.detail.issueId,
      },
      'Failed to apply issue from sidepanel'
    );
  }
}

void initSidepanel();
