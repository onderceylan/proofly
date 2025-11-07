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
  collectHighlightDetails,
  selectHighlightByWord,
  clickHighlightDetail,
  waitForHighlightCount,
  getPageBadgeCount,
  countContentEditableHighlights,
  waitForContentEditableHighlightCount,
  waitForPopoverOpen,
  waitForPopoverClosed,
  hasMirrorOverlay,
  delay,
  getImmediateHighlightCount,
  startProofreadControlCapture,
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
    await waitForHighlightCount(page, 'test-input', (count) => count > 0);

    console.log('Checking for mirror in shadow DOM');

    const mirrorOverlay = await hasMirrorOverlay(page);
    console.log(`Mirror overlay present: ${mirrorOverlay}`);
    expect(mirrorOverlay).toBe(true);

    const highlightCount = await waitForHighlightCount(page, 'test-input', (count) => count > 0);

    expect(highlightCount).toBeGreaterThan(0);
  });

  test('should not trigger proofreading on email input field', async () => {
    await page.goto('http://localhost:8080/test.html', { waitUntil: 'networkidle0' });

    await startProofreadControlCapture(page);

    await page.waitForSelector('#test-email', { timeout: 10000 });
    await page.focus('#test-email');

    await page.evaluate(() => {
      const element = document.getElementById('test-email') as HTMLInputElement | null;
      if (!element) {
        return;
      }
      element.value = 'user.name@exampl,com';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.waitForFunction(
      () => {
        const globalWindow = window as unknown as {
          __prooflyControlEvents?: Array<Record<string, any>>;
        };
        const email = document.getElementById('test-email') as HTMLInputElement | null;
        const events = globalWindow.__prooflyControlEvents || [];
        const textLength = email?.value.length ?? 0;
        return events.some(
          (event) =>
            event?.status === 'ignored' &&
            event?.reason === 'unsupported-target' &&
            event?.textLength === textLength &&
            event?.elementKind === 'input'
        );
      },
      { timeout: 10000 }
    );

    const highlightCount = await getImmediateHighlightCount(page, 'test-email');
    expect(highlightCount).toBe(0);
  });

  test('should not trigger proofreading on spellcheck-disabled text input', async () => {
    await page.goto('http://localhost:8080/test.html', { waitUntil: 'networkidle0' });

    await startProofreadControlCapture(page);

    await page.waitForSelector('#test-spellcheck-disabled', { timeout: 10000 });
    await page.focus('#test-spellcheck-disabled');

    await page.evaluate(() => {
      const element = document.getElementById(
        'test-spellcheck-disabled'
      ) as HTMLInputElement | null;
      if (!element) {
        return;
      }
      element.value = 'Spellchk is off hre';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.waitForFunction(
      () => {
        const globalWindow = window as unknown as {
          __prooflyControlEvents?: Array<Record<string, any>>;
        };
        const target = document.getElementById(
          'test-spellcheck-disabled'
        ) as HTMLInputElement | null;
        const events = globalWindow.__prooflyControlEvents || [];
        const length = target?.value.length ?? 0;
        return events.some(
          (event) =>
            event?.status === 'ignored' &&
            event?.reason === 'spellcheck-disabled' &&
            event?.textLength === length &&
            event?.elementKind === 'input'
        );
      },
      { timeout: 10000 }
    );

    const highlightCount = await getImmediateHighlightCount(page, 'test-spellcheck-disabled');
    expect(highlightCount).toBe(0);
  });

  test('should append new text to input field and update highlights', async () => {
    await page.goto('http://localhost:8080/test.html', { waitUntil: 'networkidle0' });

    await page.waitForSelector('#test-input', { timeout: 10000 });
    await page.focus('#test-input');

    await page.evaluate(() => {
      const element = document.getElementById('test-input') as HTMLInputElement;
      if (element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const initialCount = await waitForHighlightCount(page, 'test-input', (count) => count > 0);

    await page.click('#test-input');
    await page.keyboard.press('ArrowRight');
    await page.type('#test-input', ' mre errror words');

    const updatedCount = await waitForHighlightCount(
      page,
      'test-input',
      (count) => count > initialCount
    );

    expect(updatedCount).toBeGreaterThan(initialCount);
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

    await waitForHighlightCount(page, 'test-input', (count) => count > 0);

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

  test('should detect highlights after resetting input field', async () => {
    await page.waitForSelector('#test-input', { timeout: 10000 });

    await page.evaluate(() => {
      const element = document.getElementById('test-input') as HTMLInputElement | null;
      if (!element) {
        return;
      }
      element.value = 'Ths is bad txt';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const highlightCount = await waitForHighlightCount(page, 'test-input', (count) => count > 0);
    expect(highlightCount).toBeGreaterThan(0);
  });

  test('should clear input field highlights after applying all fixes', async () => {
    await ensureAutoFixOnDoubleClick(page, false);

    await page.goto('http://localhost:8080/test.html', { waitUntil: 'networkidle0' });

    await page.waitForSelector('#test-input', { timeout: 10000 });
    await page.focus('#test-input');

    await page.evaluate(() => {
      const element = document.getElementById('test-input') as HTMLInputElement;
      if (element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    let remaining = await waitForHighlightCount(page, 'test-input', (count) => count > 0);

    while (remaining > 0) {
      const highlights = await collectHighlightDetails(page, 'test-input');
      const targetHighlight = highlights[0];
      if (!targetHighlight) {
        break;
      }

      await clickHighlightDetail(page, targetHighlight);
      await waitForPopoverOpen(page);

      await delay(300);

      await page.evaluate(() => {
        const popover = document.querySelector('proofly-correction-popover');
        const applyButton = popover?.shadowRoot?.querySelector(
          '.apply-button'
        ) as HTMLButtonElement | null;
        applyButton?.click();
      });

      await waitForPopoverClosed(page);

      remaining = await waitForHighlightCount(page, 'test-input', (count) => count < remaining);
    }

    const finalHighlights = await collectHighlightDetails(page, 'test-input');
    expect(finalHighlights.length).toBe(0);

    const browser = getBrowser();
    const extensionId = getExtensionId();
    const badgeText = await getPageBadgeCount(
      browser,
      extensionId,
      'http://localhost:8080/test.html'
    );
    console.log({ badgeText });
    expect(badgeText === null || badgeText === '' || badgeText === ' ').toBe(true);
  });

  test('should apply autofix on double-click when enabled', async () => {
    await ensureAutoFixOnDoubleClick(page, true);

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

    await waitForHighlightCount(page, 'test-input', (count) => count > 0);

    const highlights = await collectHighlightDetails(page, 'test-input');
    expect(highlights.length).toBeGreaterThan(0);

    const targetHighlight = selectHighlightByWord(highlights, 'typicla');
    expect(targetHighlight).not.toBeNull();
    if (!targetHighlight) {
      return;
    }

    await clickHighlightDetail(page, targetHighlight, { doubleClick: true });

    await page.waitForFunction(
      (original, fieldId) => {
        const input = document.getElementById(fieldId) as HTMLInputElement | null;
        if (!input) {
          return false;
        }
        return input.value !== original;
      },
      { timeout: 10000 },
      originalValue,
      'test-input'
    );

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

    const finalValue = await page.$eval(
      '#test-input',
      (element) => (element as HTMLInputElement).value
    );

    expect(finalValue).not.toEqual(originalValue);
    expect(finalValue).not.toContain(targetHighlight.originalText.trim());
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
    await waitForHighlightCount(page, 'test-textarea', (count) => count > 0);

    console.log('Checking for mirror in shadow DOM');
    const mirrorOverlay = await hasMirrorOverlay(page);
    console.log(`Mirror overlay present: ${mirrorOverlay}`);
    expect(mirrorOverlay).toBe(true);

    const highlightCount = await waitForHighlightCount(page, 'test-textarea', (count) => count > 0);

    expect(highlightCount).toBeGreaterThan(0);
  });

  test('should append new text to textarea field and update highlights', async () => {
    await page.goto('http://localhost:8080/test.html', { waitUntil: 'networkidle0' });

    await page.waitForSelector('#test-textarea', { timeout: 10000 });
    await page.focus('#test-textarea');

    await page.evaluate(() => {
      const element = document.getElementById('test-textarea') as HTMLTextAreaElement;
      if (element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const initialCount = await waitForHighlightCount(page, 'test-textarea', (count) => count > 0);

    await page.click('#test-textarea');
    await page.keyboard.press('ArrowRight');
    await page.type('#test-textarea', ' more errror words appear');

    const updatedCount = await waitForHighlightCount(
      page,
      'test-textarea',
      (count) => count > initialCount
    );

    expect(updatedCount).toBeGreaterThan(initialCount);
  });

  test('should remove highlights when text is overwritten', async () => {
    await page.goto('http://localhost:8080/test.html', { waitUntil: 'networkidle0' });

    await page.waitForSelector('#test-textarea', { timeout: 10000 });
    await page.focus('#test-textarea');

    await page.evaluate(() => {
      const element = document.getElementById('test-textarea') as HTMLTextAreaElement;
      if (element) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const initialCount = await waitForHighlightCount(page, 'test-textarea', (count) => count > 0);
    expect(initialCount).toBeGreaterThan(0);

    await page.click('#test-textarea');
    await page.evaluate(() => {
      const element = document.getElementById('test-textarea') as HTMLTextAreaElement | null;
      element?.setSelectionRange(0, element.value.length);
    });

    await page.keyboard.press('Backspace');

    await delay(200);

    const clearedCount = await getImmediateHighlightCount(page, 'test-textarea');
    expect(clearedCount).toBe(0);

    await page.type('#test-textarea', 'This is a clean text with no issues.');

    const finalCount = await getImmediateHighlightCount(page, 'test-textarea');
    expect(finalCount).toBe(0);
  });

  test('should detect highlights after resetting textarea field', async () => {
    await page.waitForSelector('#test-textarea', { timeout: 10000 });

    await page.evaluate(() => {
      const element = document.getElementById('test-textarea') as HTMLTextAreaElement | null;
      if (!element) {
        return;
      }
      element.value = 'Wrong sentences are heree';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const highlightCount = await waitForHighlightCount(page, 'test-textarea', (count) => count > 0);
    expect(highlightCount).toBeGreaterThan(0);
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
    const highlightCount = await countContentEditableHighlights(page, 'test-contenteditable-div');

    console.log(`Found ${highlightCount} highlights`);
    expect(highlightCount).toBeGreaterThan(0);
  });

  test('should append new text to contenteditable input and update highlights', async () => {
    await page.goto('http://localhost:8080/test.html', { waitUntil: 'networkidle0' });

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
    const initialCount = await countContentEditableHighlights(page, 'test-contenteditable-div');
    console.log(`Found ${initialCount} highlights`);
    expect(initialCount).toBeGreaterThan(0);

    await page.evaluate(() => {
      const element = document.getElementById('test-contenteditable-div');
      if (!element) return;
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    await page.type('#test-contenteditable-div', ' even more errror text');

    const updatedHighlightCount = await waitForContentEditableHighlightCount(
      page,
      'test-contenteditable-div',
      (count) => count > initialCount
    );

    expect(updatedHighlightCount).toBeGreaterThan(initialCount);
  });

  test('should detect highlights after resetting contenteditable field', async () => {
    await page.waitForSelector('#test-contenteditable-div', { timeout: 10000 });

    await page.evaluate(() => {
      const element = document.getElementById('test-contenteditable-div');
      if (!element) {
        return;
      }
      element.textContent = 'Completly wrongg sentence';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const highlightCount = await waitForContentEditableHighlightCount(
      page,
      'test-contenteditable-div',
      (count) => count > 0
    );

    expect(highlightCount).toBeGreaterThan(0);
  });
});
