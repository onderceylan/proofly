import { describe, test, expect, beforeAll } from 'vitest';
import {
  getPage,
  getExtensionId,
  ensureModelReady,
  ensureAutoFixOnDoubleClick,
  resetExtensionStorage,
} from './helpers/fixtures';
import { getBrowser } from './helpers/setup';
import {
  waitForHighlightCount,
  getPageBadgeCount,
  getTabInfoForUrl,
  waitForSidepanelPage,
  waitForContentEditableHighlightCount,
  delay,
  startProofreadControlCapture,
  waitForProofreadingComplete,
  waitForSidebarIssueCount,
  getSidebarIssueCount,
  getSidebarIssueCardsCount,
  closeSidepanelForTab,
  toggleDevSidepanelButton,
} from './helpers/utils';
import { Page } from 'puppeteer-core';

describe('Proofly sidepanel', () => {
  let page: Page;
  beforeAll(async () => {
    const optionsPage = await getPage();
    await resetExtensionStorage(optionsPage);
    await ensureModelReady(optionsPage);
    page = await getPage();

    console.log('Navigating to test page...');
    await page.goto('http://localhost:8080/test.html', {
      waitUntil: 'networkidle0',
    });
  });

  test('should keep sidebar counts in sync and apply fix all from sidebar', async () => {
    await ensureAutoFixOnDoubleClick(page, false);

    const testPageUrl = 'http://localhost:8080/test.html';
    await page.goto(testPageUrl, { waitUntil: 'networkidle0' });
    await page.reload({ waitUntil: 'networkidle0' });

    await startProofreadControlCapture(page);
    await page.waitForSelector('#test-input', { timeout: 10000 });
    await page.focus('#test-input');
    await page.evaluate(() => {
      const element = document.getElementById('test-input') as HTMLInputElement | null;
      element?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const inputHighlightCount = await waitForHighlightCount(
      page,
      'test-input',
      (count) => count > 0
    );
    await waitForProofreadingComplete(page);
    await delay(2000);

    await startProofreadControlCapture(page);
    await page.waitForSelector('#test-textarea', { timeout: 10000 });
    await page.focus('#test-textarea');
    await page.evaluate(() => {
      const element = document.getElementById('test-textarea') as HTMLTextAreaElement | null;
      element?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const textareaHighlightCount = await waitForHighlightCount(
      page,
      'test-textarea',
      (count) => count > 0
    );
    await waitForProofreadingComplete(page);
    await delay(2000);

    await startProofreadControlCapture(page);
    await page.waitForSelector('#test-contenteditable-div', { timeout: 10000 });
    await page.focus('#test-contenteditable-div');
    await page.evaluate(() => {
      const element = document.getElementById('test-contenteditable-div');
      element?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const contentHighlightCount = await waitForContentEditableHighlightCount(
      page,
      'test-contenteditable-div',
      (count) => count > 0
    );
    await waitForProofreadingComplete(page);
    await delay(2000);

    const totalHighlights = inputHighlightCount + textareaHighlightCount + contentHighlightCount;
    expect(totalHighlights).toBeGreaterThan(0);

    const browser = getBrowser();
    const extensionId = getExtensionId();
    const tabInfo = await getTabInfoForUrl(browser, extensionId, testPageUrl);
    expect(tabInfo).not.toBeNull();
    if (!tabInfo) {
      return;
    }

    let badgeCountBefore = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      const badgeText = await getPageBadgeCount(browser, extensionId, testPageUrl);
      const normalized = Number.parseInt((badgeText ?? '').trim() || '0', 10);
      if (normalized === totalHighlights) {
        badgeCountBefore = normalized;
        break;
      }
      await delay(250);
    }
    expect(badgeCountBefore).toBe(totalHighlights);

    await toggleDevSidepanelButton(page);

    const sidebarPage = await waitForSidepanelPage(browser, extensionId);

    try {
      await waitForSidebarIssueCount(sidebarPage, totalHighlights);

      const sidebarIssueCount = await getSidebarIssueCount(sidebarPage);
      expect(sidebarIssueCount).toBe(totalHighlights);

      const sidebarIssueCards = await getSidebarIssueCardsCount(sidebarPage);
      expect(sidebarIssueCards).toBe(totalHighlights);

      await sidebarPage.click('pierce/button.fix-all-btn');

      let badgeCleared = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const badgeText = await getPageBadgeCount(browser, extensionId, testPageUrl);
        console.log('badgeText', badgeText);
        if (badgeText === null || badgeText === '' || badgeText === ' ') {
          badgeCleared = true;
          break;
        }
        await delay(250);
      }
      expect(badgeCleared).toBe(true);
      expect(await getSidebarIssueCount(sidebarPage)).toBe(0);
      expect(await getSidebarIssueCardsCount(sidebarPage)).toBe(0);
    } finally {
      await closeSidepanelForTab(browser, extensionId, tabInfo.tabId).catch(() => {});
      if (!sidebarPage.isClosed()) {
        await sidebarPage.close().catch(() => {});
      }
    }
  });
});
