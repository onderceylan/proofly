import { describe, test, expect } from 'vitest';
import { getPage, getExtensionId } from './helpers/fixtures';

describe('Proofly options page', () => {
  test('should load as expected', async () => {
    const page = await getPage();
    const extensionId = getExtensionId();

    console.log(`Navigating to: chrome-extension://${extensionId}/src/options/index.html`);
    await page.goto(`chrome-extension://${extensionId}/src/options/index.html`, {
      waitUntil: 'networkidle0',
    });

    await page.waitForSelector('h1', { timeout: 10000 });
    const h1Text = await page.$eval('h1', (el) => el.textContent);
    expect(h1Text).toBeTruthy();
  });
});
