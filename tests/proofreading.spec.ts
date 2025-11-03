import { describe, test, expect, beforeAll } from 'vitest';
import {
  getPage,
  getExtensionId,
  ensureModelReady,
  ensureAutoFixOnDoubleClick,
  resetExtensionStorage,
} from './helpers/fixtures';
import {
  collectHighlightDetails,
  selectHighlightByWord,
  clickHighlightDetail,
  waitForPopoverOpen,
  waitForPopoverClosed,
} from './helpers/utils';
import { Page } from 'puppeteer-core';

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

describe('Proofly proofreading', () => {
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

  test('should inject highlights on input field', async () => {
    console.log('Focusing input field and triggering input event');
    await page.waitForSelector('#test-input', { timeout: 10000 });
    await page.focus('#test-input');

    await page.evaluate(() => {
      const element = document.getElementById('test-input') as HTMLInputElement;
      if (element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    console.log('Waiting for proofly-highlighter to appear...');
    await page.waitForSelector('proofly-highlighter', { timeout: 10000 });

    console.log('Checking for mirror in shadow DOM');
    const hasMirrorOverlay = await page.evaluate(() => {
      const highlighter = document.querySelector('proofly-highlighter');
      if (!highlighter?.shadowRoot) return false;

      const mirror = highlighter.shadowRoot.querySelector('#mirror');
      return !!mirror;
    });

    console.log(`Mirror overlay present: ${hasMirrorOverlay}`);
    expect(hasMirrorOverlay).toBe(true);
  });

  test('should handle popover interactions for input highlights', async () => {
    await ensureAutoFixOnDoubleClick(page, false);

    await page.goto('http://localhost:8080/test.html', { waitUntil: 'networkidle0' });

    await page.waitForSelector('#test-input', { timeout: 10000 });
    await page.focus('#test-input');

    const originalValue = await page.$eval(
      '#test-input',
      (element) => (element as HTMLInputElement).value
    );

    await page.evaluate(() => {
      const element = document.getElementById('test-input') as HTMLInputElement;
      if (element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    await page.waitForSelector('proofly-highlighter', { timeout: 10000 });

    const highlights = await collectHighlightDetails(page, 'test-input');
    expect(highlights.length).toBeGreaterThan(0);

    const targetHighlight = selectHighlightByWord(highlights, 'radnom');
    expect(targetHighlight).not.toBeNull();
    if (!targetHighlight) {
      return;
    }

    const initialHighlightCount = highlights.length;
    const targetWord = targetHighlight.originalText.trim();

    await clickHighlightDetail(page, targetHighlight);
    await waitForPopoverOpen(page);

    await page.evaluate(() => {
      const popover = document.querySelector('proofly-correction-popover');
      const closeButton = popover?.shadowRoot?.querySelector(
        '.close-button'
      ) as HTMLButtonElement | null;
      closeButton?.click();
    });

    await waitForPopoverClosed(page);

    await clickHighlightDetail(page, targetHighlight);
    await waitForPopoverOpen(page);

    await page.keyboard.press('Escape');

    await waitForPopoverClosed(page);

    await clickHighlightDetail(page, targetHighlight);
    await waitForPopoverOpen(page);

    const suggestion = await page.evaluate(() => {
      const popover = document.querySelector('proofly-correction-popover');
      const suggestion = popover?.shadowRoot?.querySelector('#suggestion');
      return suggestion?.textContent ?? null;
    });

    await page.evaluate(() => {
      const popover = document.querySelector('proofly-correction-popover');
      const applyButton = popover?.shadowRoot?.querySelector(
        '.apply-button'
      ) as HTMLButtonElement | null;
      applyButton?.click();
    });

    await waitForPopoverClosed(page);

    await page.waitForFunction(
      (issueId) => {
        const host = document.querySelector('proofly-highlighter');
        if (!host?.shadowRoot) {
          return true;
        }
        return !host.shadowRoot.querySelector(`.u[data-issue-id="${issueId}"]`);
      },
      { timeout: 10000 },
      targetHighlight.issueId
    );

    await page.waitForFunction(
      (expectedCount) => {
        const host = document.querySelector('proofly-highlighter');
        if (!host?.shadowRoot) {
          return expectedCount === 0;
        }
        const currentCount = host.shadowRoot.querySelectorAll('.u').length;
        return currentCount <= expectedCount;
      },
      { timeout: 10000 },
      Math.max(initialHighlightCount - 1, 0)
    );

    const finalValue = await page.$eval(
      '#test-input',
      (element) => (element as HTMLInputElement).value
    );

    expect(finalValue).not.toEqual(originalValue);
    if (targetWord.length > 0) {
      expect(finalValue).not.toContain(targetWord);
    }
    if (suggestion && suggestion !== '') {
      expect(finalValue).toContain(suggestion);
    }
  });

  test('should inject highlights on textarea field', async () => {
    console.log('Focusing textarea field and triggering input event');
    await page.waitForSelector('#test-textarea', { timeout: 10000 });
    await page.focus('#test-textarea');

    await page.evaluate(() => {
      const element = document.getElementById('test-textarea') as HTMLTextAreaElement;
      if (element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    console.log('Waiting for proofly-highlighter to appear...');
    await page.waitForSelector('proofly-highlighter', { timeout: 10000 });

    console.log('Checking for mirror in shadow DOM');
    const hasMirrorOverlay = await page.evaluate(() => {
      const highlighter = document.querySelector('proofly-highlighter');
      if (!highlighter?.shadowRoot) return false;

      const mirror = highlighter.shadowRoot.querySelector('#mirror');
      return !!mirror;
    });

    console.log(`Mirror overlay present: ${hasMirrorOverlay}`);
    expect(hasMirrorOverlay).toBe(true);
  });

  test('should inject highlights on contenteditable input', async () => {
    console.log('Focusing contenteditable div and triggering input event');
    await page.waitForSelector('#test-contenteditable-div', { timeout: 10000 });
    await page.focus('#test-contenteditable-div');

    await page.evaluate(() => {
      const element = document.getElementById('test-contenteditable-div');
      if (element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    console.log('Waiting for highlights to be injected...');
    await page.waitForFunction(
      () => {
        if (!('highlights' in CSS)) return false;
        const errorTypes = [
          'spelling',
          'grammar',
          'punctuation',
          'capitalization',
          'preposition',
          'missing-words',
        ];
        for (const errorType of errorTypes) {
          const highlight = CSS.highlights.get(errorType);
          if (highlight && highlight.size > 0) {
            return true;
          }
        }
        return false;
      },
      { timeout: 10000 }
    );

    console.log('Counting highlights');
    const highlightCount = await page.evaluate(() => {
      let totalRanges = 0;
      const errorTypes = [
        'spelling',
        'grammar',
        'punctuation',
        'capitalization',
        'preposition',
        'missing-words',
      ];
      for (const errorType of errorTypes) {
        const highlight = CSS.highlights.get(errorType);
        if (highlight) {
          totalRanges += highlight.size;
        }
      }
      return totalRanges;
    });

    console.log(`Found ${highlightCount} highlights`);
    expect(highlightCount).toBeGreaterThan(0);
  });
});
