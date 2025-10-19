import { initializeStorage } from '../shared/utils/storage.ts';

chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
  console.log('Proofly extension installed and storage initialized');

  chrome.contextMenus.create({
    id: 'proofly-check',
    title: 'Check with Proofly',
    contexts: ['selection', 'editable'],
  });
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeStorage();
  console.log('Proofly extension started');
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'proofly-check' && tab?.id) {
    await chrome.tabs.sendMessage(tab.id, { type: 'proofread-selection' });
  }
});
