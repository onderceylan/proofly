import '../shared/components/model-downloader.ts';
import './components/issues-panel.ts';
import './style.css';

import { logger } from '../services/logger.ts';
import { isModelReady } from '../shared/utils/storage.ts';
import type {
  ApplyAllIssuesMessage,
  IssuesStateRequestMessage,
  IssuesStateResponseMessage,
  IssuesUpdateMessage,
  IssuesUpdatePayload,
  ProoflyMessage,
  ProofreaderStateUpdateMessage,
  ProofreaderBusyStateRequestMessage,
  ProofreaderBusyStateResponseMessage,
  PreviewIssueMessage,
} from '../shared/messages/issues.ts';
import { ProoflyIssuesPanel } from './components/issues-panel.ts';
import { ensureProofreaderModelReady } from '../services/model-checker.ts';

type ApplyIssueDetail = { elementId: string; issueId: string };
type FixAllIssuesDetail = { elementId?: string };
type PreviewIssueDetail = { issueId: string; elementId: string; active: boolean };

let panelElement: ProoflyIssuesPanel | null = null;
let appContainer: HTMLDivElement | null = null;
let activeTabId: number | null = null;
let currentWindowId: number | undefined;
let messageListenerRegistered = false;
let tabActivationListenerRegistered = false;
let tabRemovalListenerRegistered = false;
let panelBusy = false;

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
  panelElement.addEventListener('open-settings', onOpenSettings);
  panelElement.addEventListener('fix-all-issues', onFixAllIssues);
  panelElement.addEventListener('preview-issue', onPreviewIssue);

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
    await Promise.all([requestIssuesState(tab.id), requestBusyState(tab.id)]);
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

  if (message.type === 'proofly:proofreader-state-update') {
    handleProofreaderStateUpdate(message);
    return false;
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

  const senderUrl = sender.tab?.url ?? '';
  const isOptionsPage = senderUrl.includes('/src/options/index.html');

  if (activeTabId !== senderTabId && !isOptionsPage) {
    return false;
  }

  if (isOptionsPage) {
    activeTabId = senderTabId;
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
  await Promise.all([requestIssuesState(activeInfo.tabId), requestBusyState(activeInfo.tabId)]);
}

function handleTabRemoved(tabId: number): void {
  if (tabId === activeTabId) {
    activeTabId = null;
    updatePanelState(null);
    panelBusy = false;
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

async function requestBusyState(tabId: number): Promise<void> {
  try {
    const message: ProofreaderBusyStateRequestMessage = {
      type: 'proofly:get-proofreader-busy-state',
      payload: { tabId },
    };
    const response = (await chrome.runtime.sendMessage(
      message
    )) as ProofreaderBusyStateResponseMessage;

    if (response?.type !== 'proofly:proofreader-busy-state') {
      logger.warn({ tabId }, 'Unexpected response for busy state request');
      return;
    }

    panelBusy = response.payload.busy;
    document.body.classList.toggle('prfly-panel-busy', panelBusy);
  } catch (error) {
    logger.error({ error, tabId }, 'Failed to request busy state');
  }
}

function onApplyIssue(event: Event): void {
  void handleApplyIssue(event as CustomEvent<ApplyIssueDetail>);
}

function onOpenSettings(): void {
  void chrome.runtime.openOptionsPage().catch((error) => {
    logger.error({ error }, 'Failed to open settings from sidepanel');
  });
}

function onFixAllIssues(event: Event): void {
  void handleFixAllIssues((event as CustomEvent<FixAllIssuesDetail>).detail?.elementId);
}

function onPreviewIssue(event: Event): void {
  void handlePreviewIssue((event as CustomEvent<PreviewIssueDetail>).detail);
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

async function handleFixAllIssues(elementId?: string): Promise<void> {
  if (!activeTabId) {
    logger.warn('Fix all issues requested without an active tab');
    return;
  }

  try {
    const message: ApplyAllIssuesMessage = elementId
      ? {
          type: 'proofly:apply-all-issues',
          payload: { elementId },
        }
      : { type: 'proofly:apply-all-issues' };

    await chrome.tabs.sendMessage(activeTabId, message);
    logger.info({ tabId: activeTabId, elementId }, 'Fix all issues dispatched');
  } catch (error) {
    logger.error(
      { error, tabId: activeTabId, elementId },
      'Failed to fix all issues from sidepanel'
    );
  }
}

async function handlePreviewIssue(detail?: PreviewIssueDetail): Promise<void> {
  if (!detail) {
    return;
  }

  if (!activeTabId) {
    return;
  }

  const message: PreviewIssueMessage = {
    type: 'proofly:preview-issue',
    payload: {
      elementId: detail.elementId,
      issueId: detail.issueId,
      active: detail.active,
    },
  };

  try {
    await chrome.tabs.sendMessage(activeTabId, message);
  } catch (error) {
    logger.warn({ error, tabId: activeTabId }, 'Failed to preview issue from sidepanel');
  }
}

function handleProofreaderStateUpdate(message: ProofreaderStateUpdateMessage): void {
  if (activeTabId !== message.payload.tabId) {
    return;
  }

  panelBusy = message.payload.busy;

  document.body.classList.toggle('prfly-panel-busy', panelBusy);
}

void initSidepanel();
