import { logger } from "../services/logger.ts";
import { ProofreadingManager } from './proofreading-manager.ts';
import { isModelReady } from '../shared/utils/storage.ts';

let manager: ProofreadingManager | null = null;

async function initProofreading() {
  logger.info('Content script loaded');

  try {
    const modelReady = await isModelReady();
    logger.info({ modelReady }, 'Model ready check:');

    if (!modelReady) {
      logger.info('AI model not ready. Please download the model from the extension options page.');
      return;
    }

    if (manager) {
      return;
    }

    manager = new ProofreadingManager();
    await manager.initialize();

    logger.info('Proofreading enabled');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize');
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'proofread-selection') {
    manager?.proofreadActiveElement();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'proofly:apply-issue') {
    if (message.payload?.elementId && message.payload?.issueId) {
      manager?.applyIssue(message.payload.elementId, message.payload.issueId);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false });
    }
    return true;
  }

  return false;
});

// Execute immediately - bypass CRXJS loader
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProofreading);
} else {
  void initProofreading();
}

// CRXJS loader expects this export (keep for compatibility)
export function onExecute(config?: { perf?: { injectTime: number; loadTime: number } }) {
  logger.info(config, 'onExecute called with config');
  // Already executed above, so this is a no-op
}
