import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import {
  getPage,
  getExtensionId,
  ensureModelReady,
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
  toggleDevSidepanelButton,
  collectHighlightDetails,
} from './helpers/utils';
import { Browser, Page } from 'puppeteer-core';

describe('Proofly sidepanel', () => {
  let page: Page;
  let sidebarPage: Page;
  let browser: Browser;
  let extensionId: string;
  const testPageUrl = `http://localhost:8080/test.html`;
  beforeAll(async () => {
    const optionsPage = await getPage();
    await resetExtensionStorage(optionsPage);
    await ensureModelReady(optionsPage);

    page = await getPage();

    console.log('Navigating to test page...');
    await page.goto('http://localhost:8080/test.html', {
      waitUntil: 'networkidle0',
    });

    await toggleDevSidepanelButton(page);

    browser = getBrowser();
    extensionId = getExtensionId();
    sidebarPage = await waitForSidepanelPage(browser, extensionId);
  });

  afterAll(async () => {
    await toggleDevSidepanelButton(page);
  });

  test('should keep sidebar counts in sync and apply fix all from sidebar', async () => {
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
  });

  test('should apply fix all only to the scoped element group', async () => {
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

    const totalHighlights = inputHighlightCount + textareaHighlightCount;
    expect(totalHighlights).toBeGreaterThanOrEqual(2);

    await waitForSidebarIssueCount(sidebarPage, totalHighlights);
    const initialSidebarCount = await getSidebarIssueCount(sidebarPage);
    expect(initialSidebarCount).toBe(totalHighlights);

    type SidebarGroupSummary = {
      elementId: string;
      issueCount: number;
      label: string;
    };
    const groupSummaries = (await sidebarPage.evaluate(() => {
      const panel = document.querySelector('prfly-issues-panel');
      const root = panel?.shadowRoot;
      if (!root) {
        return [];
      }
      return Array.from(root.querySelectorAll('article.group')).map((group) => {
        const elementId = group.getAttribute('data-element-id') ?? '';
        const issueCount = group.querySelectorAll('.issue').length;
        const label = group.querySelector('.group__title')?.textContent?.trim() ?? '';
        return { elementId, issueCount, label };
      });
    })) as SidebarGroupSummary[];

    expect(groupSummaries.length).toBeGreaterThanOrEqual(2);

    const inputGroup = groupSummaries.find((group) => group.label.toLowerCase().includes('input'));
    expect(inputGroup).toBeDefined();
    expect(inputGroup?.issueCount).toBeGreaterThan(0);
    if (!inputGroup) {
      return;
    }

    const textareaGroup = groupSummaries.find((group) =>
      group.label.toLowerCase().includes('textarea')
    );
    expect(textareaGroup).toBeDefined();
    expect(textareaGroup?.issueCount).toBeGreaterThan(0);

    await sidebarPage.click(
      `pierce/article.group[data-element-id="${inputGroup.elementId}"] button.group__fix-all-btn`
    );

    await waitForHighlightCount(page, 'test-input', (count) => count === 0, {
      timeout: 10000,
    });

    const remainingTextareaHighlights = await collectHighlightDetails(page, 'test-textarea');
    expect(remainingTextareaHighlights.length).toBeGreaterThan(0);

    await waitForSidebarIssueCount(sidebarPage, initialSidebarCount - inputGroup.issueCount);

    const remainingSidebarCount = await getSidebarIssueCount(sidebarPage);
    expect(remainingSidebarCount).toBeGreaterThan(0);
    const remainingSidebarCards = await getSidebarIssueCardsCount(sidebarPage);
    expect(remainingSidebarCards).toBeGreaterThan(0);
  });
});
