import type { Page } from 'puppeteer-core';

export interface HighlightDetail {
  issueId: string;
  originalText: string;
  centerX: number;
  centerY: number;
  start: number;
  end: number;
}

const HOST_MATCH_TOLERANCE = 5;

export async function collectHighlightDetails(page: Page, fieldId: string): Promise<HighlightDetail[]> {
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
        return null;
      }

      const highlightNodes = Array.from(hostForField.shadowRoot.querySelectorAll('.u'));
      if (highlightNodes.length === 0) {
        return null;
      }

      const value =
        field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
          ? field.value
          : field.textContent ?? '';

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
    const match = highlights.find((detail) => detail.originalText.trim().toLowerCase() === normalized);
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
  highlight: HighlightDetail
): Promise<void> {
  await page.mouse.move(highlight.centerX, highlight.centerY);
  await page.mouse.click(highlight.centerX, highlight.centerY, { delay: 20 });

  await page.evaluate(
    ({ issueId, clientX, clientY }) => {
      const hosts = Array.from(document.querySelectorAll('proofly-highlighter'));
      for (const host of hosts) {
        const highlightNode = host.shadowRoot?.querySelector(
          `.u[data-issue-id="${issueId}"]`
        ) as HTMLElement | null;
        if (highlightNode) {
          highlightNode.dispatchEvent(
            new MouseEvent('click', {
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
    }
  );
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
