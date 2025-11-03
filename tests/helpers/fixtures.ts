import type { Page } from 'puppeteer-core';
import { getBrowser, EXTENSION_ID } from './setup';

export function getExtensionId(): string {
  return EXTENSION_ID;
}

export async function getPage(): Promise<Page> {
  const browser = getBrowser();
  const pages = await browser.pages();

  return pages.length > 0 ? pages[0] : await browser.newPage();
}

export async function ensureAutoFixOnDoubleClick(
  page: Page,
  autofixOnDoubleClick: boolean
): Promise<void> {
  const extensionId = getExtensionId();

  await page.goto(`chrome-extension://${extensionId}/src/options/index.html`, {
    waitUntil: 'networkidle0',
  });

  await page.evaluate(async (value) => {
    await chrome.storage.sync.set({ autofixOnDoubleClick: value });
  }, autofixOnDoubleClick);
}

export async function ensureModelReady(page: Page): Promise<void> {
  console.log('Warming up model by visiting options page...');
  await page.goto(`chrome-extension://${EXTENSION_ID}/src/options/index.html`, {
    waitUntil: 'networkidle0',
  });

  console.log('Waiting for model to be ready (refreshing until ready)...');
  const maxRetries = 10;
  let modelReady = false;

  for (let i = 0; i < maxRetries; i++) {
    const bodyText = await page.evaluate(() => document.body.textContent || '');

    if (bodyText.includes('AI Model Ready')) {
      console.log('Model is ready!');
      modelReady = true;
      break;
    }

    console.log(`Model not ready yet (attempt ${i + 1}/${maxRetries}), refreshing...`);
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (!modelReady) {
    throw new Error('Model did not become ready after maximum retries');
  }
}

export async function resetExtensionStorage(page: Page): Promise<void> {
  await page.goto(`chrome-extension://${EXTENSION_ID}/src/options/index.html`, {
    waitUntil: 'networkidle0',
  });

  await page.evaluate(async () => {
    await Promise.all([chrome.storage.local.clear(), chrome.storage.sync.clear()]);
  });
}
