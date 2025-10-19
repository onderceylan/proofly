console.log('Proofly: TOP OF FILE - Script is loading!');

import { ProofreadingManager } from './proofreading-manager.ts';
import { isModelReady } from '../shared/utils/storage.ts';

console.log('Proofly: After imports');

let manager: ProofreadingManager | null = null;

async function initProofreading() {
  console.log('Proofly: Content script loaded');

  try {
    const modelReady = await isModelReady();
    console.log('Proofly: Model ready check:', modelReady);

    if (!modelReady) {
      console.log('Proofly: AI model not ready. Please download the model from the extension options page.');
      return;
    }

    if (manager) {
      return;
    }

    manager = new ProofreadingManager();
    await manager.initialize();

    console.log('Proofly: Proofreading enabled');
  } catch (error) {
    console.error('Proofly: Failed to initialize:', error);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'proofread-selection') {
    manager?.proofreadActiveElement();
    sendResponse({ success: true });
  }
  return true;
});

// Execute immediately - bypass CRXJS loader
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProofreading);
} else {
  void initProofreading();
}

// CRXJS loader expects this export (keep for compatibility)
export function onExecute(config?: { perf?: { injectTime: number; loadTime: number } }) {
  console.log('Proofly: onExecute called with config:', config);
  // Already executed above, so this is a no-op
}
