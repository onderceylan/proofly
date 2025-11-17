import type { Browser, Page, WebWorker } from 'puppeteer-core';
import { DEV_SIDE_PANEL_BUTTON_ID } from '../../src/content/dev-sidepanel-button.ts';

export interface HighlightDetail {
  issueId: string;
  originalText: string;
  centerX: number;
  centerY: number;
  start: number;
  end: number;
}

const HOST_MATCH_TOLERANCE = 5;
const ERROR_TYPES = [
  'spelling',
  'grammar',
  'punctuation',
  'capitalization',
  'preposition',
  'missing-words',
];

export async function collectHighlightDetails(
  page: Page,
  fieldId: string
): Promise<HighlightDetail[]> {
  const handle = await page.waitForFunction(
    (id, tolerance) => {
      const field = document.getElementById(id);
      if (!(field instanceof HTMLElement)) {
        return null;
      }

      const fieldRect = field.getBoundingClientRect();
      const hosts = Array.from(document.querySelectorAll('proofly-highlighter'));
      const hostForField = hosts.find((host) => {
        const rect = host.getBoundingClientRect();
        return (
          Math.abs(rect.left - fieldRect.left) <= tolerance &&
          Math.abs(rect.top - fieldRect.top) <= tolerance
        );
      });

      if (!hostForField?.shadowRoot) {
        return [];
      }

      const highlightNodes = Array.from(hostForField.shadowRoot.querySelectorAll('.u'));
      if (highlightNodes.length === 0) {
        return [];
      }

      const value =
        field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
          ? field.value
          : (field.textContent ?? '');

      return highlightNodes.map((node) => {
        const issueId = node.getAttribute('data-issue-id') ?? '';
        const [startString, endString] = issueId.split(':');
        const start = Number.parseInt(startString ?? '', 10);
        const end = Number.parseInt(endString ?? '', 10);
        const rect = node.getBoundingClientRect();

        return {
          issueId,
          start,
          end,
          originalText: value.slice(start, end),
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        } satisfies HighlightDetail;
      });
    },
    { timeout: 15000 },
    fieldId,
    HOST_MATCH_TOLERANCE
  );

  const details = (await handle.jsonValue()) as HighlightDetail[] | null;
  if (!details) {
    return [];
  }
  return details;
}

export function selectHighlightByWord(
  highlights: HighlightDetail[],
  target?: string
): HighlightDetail | null {
  if (!highlights.length) {
    return null;
  }

  if (target) {
    const normalized = target.trim().toLowerCase();
    const match = highlights.find(
      (detail) => detail.originalText.trim().toLowerCase() === normalized
    );
    if (match) {
      return match;
    }

    const containsMatch = highlights.find((detail) =>
      detail.originalText.trim().toLowerCase().includes(normalized)
    );
    if (containsMatch) {
      return containsMatch;
    }
  }

  return highlights[0];
}

export async function clickHighlightDetail(
  page: Page,
  highlight: HighlightDetail,
  options: { doubleClick?: boolean } = {}
): Promise<void> {
  await page.mouse.move(highlight.centerX, highlight.centerY);
  if (options.doubleClick) {
    await page.mouse.click(highlight.centerX, highlight.centerY, { delay: 20, clickCount: 2 });
  } else {
    await page.mouse.click(highlight.centerX, highlight.centerY, { delay: 20 });
  }

  await page.evaluate(
    ({ issueId, clientX, clientY, doubleClick }) => {
      const hosts = Array.from(document.querySelectorAll('proofly-highlighter'));
      for (const host of hosts) {
        const highlightNode = host.shadowRoot?.querySelector(
          `.u[data-issue-id="${issueId}"]`
        ) as HTMLElement | null;
        if (highlightNode) {
          highlightNode.dispatchEvent(
            new MouseEvent(doubleClick ? 'dblclick' : 'click', {
              bubbles: true,
              composed: true,
              cancelable: true,
              clientX,
              clientY,
            })
          );
          return;
        }
      }
    },
    {
      issueId: highlight.issueId,
      clientX: highlight.centerX,
      clientY: highlight.centerY,
      doubleClick: Boolean(options.doubleClick),
    }
  );
}

interface HighlightWaitOptions {
  timeout?: number;
  interval?: number;
}

export async function waitForHighlightCount(
  page: Page,
  fieldId: string,
  predicate: (count: number) => boolean,
  options: HighlightWaitOptions = {}
): Promise<number> {
  const timeout = options.timeout ?? 10000;
  const interval = options.interval ?? 200;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const highlights = await collectHighlightDetails(page, fieldId);
    if (predicate(highlights.length)) {
      return highlights.length;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Highlight count did not satisfy predicate for ${fieldId}`);
}

interface HighlighterPresenceOptions {
  present?: boolean;
  timeout?: number;
  tolerance?: number;
  interval?: number;
}

export async function hasHighlighterHost(
  page: Page,
  fieldId: string,
  tolerance = HOST_MATCH_TOLERANCE
): Promise<boolean> {
  return page.evaluate(
    (id, tol) => {
      const field = document.getElementById(id);
      if (!(field instanceof HTMLElement)) {
        return false;
      }

      const fieldRect = field.getBoundingClientRect();
      const hosts = Array.from(document.querySelectorAll('proofly-highlighter'));
      const match = hosts.find((host) => {
        const rect = host.getBoundingClientRect();
        return (
          Math.abs(rect.left - fieldRect.left) <= tol && Math.abs(rect.top - fieldRect.top) <= tol
        );
      });

      return Boolean(match);
    },
    fieldId,
    tolerance
  );
}

export async function waitForHighlighterPresence(
  page: Page,
  fieldId: string,
  options: HighlighterPresenceOptions = {}
): Promise<void> {
  const {
    present = true,
    timeout = 10000,
    tolerance = HOST_MATCH_TOLERANCE,
    interval = 200,
  } = options;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const hasHost = await hasHighlighterHost(page, fieldId, tolerance);
    if (present ? hasHost : !hasHost) {
      return;
    }
    await delay(interval);
  }

  throw new Error(
    `Highlighter presence for ${fieldId} did not reach expected state: ${present ? 'present' : 'absent'}`
  );
}

export async function countContentEditableHighlights(page: Page, fieldId: string): Promise<number> {
  return page.evaluate(
    (id, errorTypes) => {
      const element = document.getElementById(id);
      if (!element) {
        throw new Error('Could not find element');
      }
      if (!('highlights' in CSS)) {
        throw new Error('CSS highlights is not supported');
      }

      let total = 0;

      for (const type of errorTypes as string[]) {
        const highlight = CSS.highlights.get(type);
        if (!highlight) continue;
        for (const range of highlight as any) {
          const container = range.commonAncestorContainer as Node | null;
          if (!container) {
            continue;
          }
          const elementContainer =
            container.nodeType === Node.ELEMENT_NODE
              ? (container as Element)
              : (container.parentElement as Element | null);

          if (elementContainer && element.contains(elementContainer)) {
            total += 1;
          }
        }
      }

      return total;
    },
    fieldId,
    ERROR_TYPES
  );
}

export async function startProofreadControlCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const globalWindow = window as unknown as {
      __prooflyControlEvents?: any[];
      __prooflyControlEventsListener?: (event: Event) => void;
    };

    if (globalWindow.__prooflyControlEventsListener) {
      window.removeEventListener(
        'proofly:proofread-control',
        globalWindow.__prooflyControlEventsListener
      );
    }

    globalWindow.__prooflyControlEvents = [];

    const listener = (event: Event) => {
      const customEvent = event as CustomEvent;
      globalWindow.__prooflyControlEvents?.push(customEvent.detail);
    };

    window.addEventListener('proofly:proofread-control', listener);
    globalWindow.__prooflyControlEventsListener = listener;
  });
}

export async function waitForContentEditableHighlightCount(
  page: Page,
  fieldId: string,
  predicate: (count: number) => boolean,
  options: HighlightWaitOptions = {}
): Promise<number> {
  const timeout = options.timeout ?? 10000;
  const interval = options.interval ?? 200;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const count = await countContentEditableHighlights(page, fieldId);
    if (predicate(count)) {
      return count;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Contenteditable highlight count did not satisfy predicate for ${fieldId}`);
}

export async function getPageBadgeCount(
  browser: import('puppeteer-core').Browser,
  extensionId: string,
  targetUrl: string
): Promise<string | null> {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/index.html`, {
    waitUntil: 'domcontentloaded',
  });

  const badgeText = await page.evaluate(async (url) => {
    if (!chrome?.action?.getBadgeText) {
      return null;
    }
    const tabs = await chrome.tabs.query({ url });
    const tabId = tabs[0]?.id;
    if (typeof tabId !== 'number') {
      return null;
    }
    return chrome.action.getBadgeText({ tabId });
  }, targetUrl);

  await page.close();
  return badgeText ?? null;
}

export interface TabInfo {
  tabId: number;
  windowId?: number;
}

export async function getTabInfoForUrl(
  browser: Browser,
  extensionId: string,
  targetUrl: string
): Promise<TabInfo | null> {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/index.html`, {
    waitUntil: 'domcontentloaded',
  });

  const info = (await page.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url });
    const target = tabs[0];
    if (!target?.id) {
      return null;
    }

    return {
      tabId: target.id,
      windowId: target.windowId,
    } satisfies TabInfo;
  }, targetUrl)) as TabInfo | null;

  await page.close();
  return info;
}

async function getExtensionServiceWorker(
  browser: Browser,
  extensionId: string
): Promise<WebWorker> {
  const existingTarget = browser
    .targets()
    .find(
      (target) =>
        target.type() === 'service_worker' &&
        target.url().startsWith(`chrome-extension://${extensionId}/`)
    );

  const serviceWorkerTarget =
    existingTarget ??
    (await browser.waitForTarget(
      (target) =>
        target.type() === 'service_worker' &&
        target.url().startsWith(`chrome-extension://${extensionId}/`),
      { timeout: 10000 }
    ));

  if (!serviceWorkerTarget) {
    throw new Error('Failed to locate extension service worker');
  }

  const worker = await serviceWorkerTarget.worker();
  if (!worker) {
    throw new Error('Failed to connect to extension service worker');
  }

  return worker;
}

export async function waitForSidepanelPage(browser: Browser, _extensionId: string): Promise<Page> {
  const existingTarget = browser
    .targets()
    .find((target) => target.url().includes('sidepanel/index.html'));

  const sidepanelTarget =
    existingTarget ??
    (await browser.waitForTarget((target) => target.url().includes('sidepanel/index.html'), {
      timeout: 10000,
    }));

  if (!sidepanelTarget) {
    throw new Error('Failed to locate sidepanel target');
  }

  const targetInfo = (sidepanelTarget as unknown as { _targetInfo?: { type?: string } })
    ._targetInfo;
  if (targetInfo) {
    targetInfo.type = 'page';
  }

  const sidepanelPage = await sidepanelTarget.asPage();
  if (!sidepanelPage) {
    throw new Error('Failed to attach to sidepanel page');
  }

  await sidepanelPage.waitForSelector('prfly-issues-panel', { timeout: 10000 });
  return sidepanelPage;
}

export async function closeSidepanelForTab(
  browser: Browser,
  extensionId: string,
  tabId: number
): Promise<void> {
  const worker = await getExtensionServiceWorker(browser, extensionId);

  await worker.evaluate(
    async ({ targetTabId }) => {
      if (!chrome?.sidePanel) {
        return;
      }

      const closeFn = (
        chrome.sidePanel as typeof chrome.sidePanel & {
          close?: (options: { tabId: number }) => Promise<void>;
        }
      ).close;

      if (!closeFn) {
        return;
      }

      await closeFn({ tabId: targetTabId });
    },
    { targetTabId: tabId }
  );
}

export async function waitForProofreadingComplete(page: Page) {
  return page.waitForFunction(
    () => {
      const globalWindow = window as unknown as {
        __prooflyControlEvents?: Array<Record<string, any>>;
      };
      const events = globalWindow.__prooflyControlEvents || [];
      return events.some((event) => event?.status === 'complete');
    },
    { timeout: 10000 }
  );
}

export async function getSidebarIssueCount(sidebarPage: Page) {
  const sidebarIssueCount = await sidebarPage.evaluate(() => {
    const panel = document.querySelector('prfly-issues-panel');
    const badge = panel?.shadowRoot?.querySelector('.issue__count');
    const value = Number.parseInt(badge?.textContent?.trim() ?? '', 10);
    return Number.isFinite(value) ? value : 0;
  });
  return sidebarIssueCount;
}

export async function getSidebarIssueCardsCount(sidebarPage: Page) {
  return await sidebarPage.evaluate(() => {
    const panel = document.querySelector('prfly-issues-panel');
    return panel?.shadowRoot?.querySelectorAll('.issue').length ?? 0;
  });
}

export async function waitForSidebarIssueCount(sidebarPage: Page, totalHighlights: number) {
  await sidebarPage.waitForFunction(
    (expected) => {
      const panel = document.querySelector('prfly-issues-panel');
      const badge = panel?.shadowRoot?.querySelector('.issue__count');
      const value = Number.parseInt(badge?.textContent?.trim() ?? '', 10);
      return Number.isFinite(value) && value === expected;
    },
    { timeout: 10000 },
    totalHighlights
  );
}

export async function hasMirrorOverlay(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const highlighter = document.querySelector('proofly-highlighter');
    if (!highlighter?.shadowRoot) return false;

    const mirror = highlighter.shadowRoot.querySelector('#mirror');
    return Boolean(mirror);
  });
}

export async function waitForPopoverOpen(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    () => {
      const popover = document.querySelector('proofly-correction-popover');
      return popover?.matches(':popover-open') ?? false;
    },
    { timeout }
  );
}

export async function waitForPopoverClosed(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () => {
      const popover = document.querySelector('proofly-correction-popover');
      if (!popover) {
        return true;
      }
      return !popover.matches(':popover-open');
    },
    { timeout }
  );
}

export async function delay(millis: number) {
  return new Promise((resolve) => setTimeout(resolve, millis));
}

export async function triggerProofreadShortcut(page: Page): Promise<void> {
  const modifier = navigator.platform.toLowerCase().includes('mac') ? 'Meta' : 'Control';

  await page.keyboard.down(modifier);
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyP');
  await page.keyboard.up('Shift');
  await page.keyboard.up(modifier);
}

export async function getImmediateHighlightCount(page: Page, fieldId: string): Promise<number> {
  return page.evaluate((id, tolerance = 5) => {
    const field = document.getElementById(id);
    if (!(field instanceof HTMLElement)) {
      return 0;
    }

    const fieldRect = field.getBoundingClientRect();
    const hosts = Array.from(document.querySelectorAll('proofly-highlighter'));
    const hostForField = hosts.find((host) => {
      const rect = host.getBoundingClientRect();
      return (
        Math.abs(rect.left - fieldRect.left) <= tolerance &&
        Math.abs(rect.top - fieldRect.top) <= tolerance
      );
    });

    if (!hostForField?.shadowRoot) {
      return 0;
    }

    return hostForField.shadowRoot.querySelectorAll('.u').length;
  }, fieldId);
}

export async function toggleDevSidepanelButton(page: Page): Promise<void> {
  await page.waitForSelector(`#${DEV_SIDE_PANEL_BUTTON_ID}`, { timeout: 10000 });
  await page.waitForFunction(
    (buttonId) => {
      const host = document.getElementById(buttonId);
      return Boolean(host?.shadowRoot?.querySelector('button'));
    },
    { timeout: 10000 },
    DEV_SIDE_PANEL_BUTTON_ID
  );

  await page.evaluate((buttonId) => {
    const host = document.getElementById(buttonId);
    if (!host?.shadowRoot) {
      throw new Error('Dev sidepanel button missing shadow root');
    }

    const button = host.shadowRoot.querySelector<HTMLButtonElement>('button');
    if (!button) {
      throw new Error('Dev sidepanel toggle button not found');
    }

    button.click();
  }, DEV_SIDE_PANEL_BUTTON_ID);
}
