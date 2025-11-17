import fs from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'puppeteer-core';

type ExtensionTimestamp = number | string;

interface ExtensionLog {
  ctx: string;
  level: string;
  msg: unknown[];
  sid: string;
  t: ExtensionTimestamp;
}

interface FetchLogParams {
  since?: number;
  sessionId?: string;
  maxEntries: number;
  contextType: string;
  logLevel: string;
}

const DEFAULT_FETCH_PARAMS: FetchLogParams = {
  maxEntries: 1000,
  contextType: 'all',
  logLevel: 'all',
};

function toTimestampMillis(value: ExtensionTimestamp): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numericValue = Number(value);
    if (!Number.isNaN(numericValue)) {
      return numericValue;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return null;
}

function formatLog(log: ExtensionLog): string {
  const timestampValue = toTimestampMillis(log.t);
  const timestamp =
    timestampValue !== null
      ? new Date(timestampValue).toISOString()
      : typeof log.t === 'string'
        ? log.t
        : 'unknown';
  const level = log.level.toUpperCase();
  const context = log.ctx;
  const message = Array.isArray(log.msg) ? log.msg.join(' ') : String(log.msg);
  return `[${timestamp}] [${level}] [${context}] ${message}`;
}

interface LogWriterOptions extends Partial<FetchLogParams> {
  targetUrl?: string;
}

export async function writeExtensionLogsToFile(
  browser: Browser,
  extensionId: string,
  options: LogWriterOptions = {}
): Promise<void> {
  const params: FetchLogParams = { ...DEFAULT_FETCH_PARAMS, ...options };
  const outputPath = path.join(process.cwd(), '/e2e/logs.txt');

  const pages = await browser.pages();
  const originalPage = pages.length > 0 ? pages[0] : null;
  const tempPage = await browser.newPage();

  try {
    const optionsUrl = `chrome-extension://${extensionId}/src/options/index.html`;
    try {
      await tempPage.goto(optionsUrl, { waitUntil: 'networkidle0', timeout: 10000 });
    } catch {
      const fallbackUrl = `chrome-extension://${extensionId}/`;
      await tempPage.goto(fallbackUrl, { waitUntil: 'networkidle0', timeout: 10000 });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    const logs = await tempPage.evaluate(async (fetchParams: FetchLogParams) => {
      const { since, sessionId, maxEntries, contextType, logLevel } = fetchParams;

      try {
        const result = await chrome.storage.local.get('__dev_logs');
        const allLogs = (result.__dev_logs ?? []) as ExtensionLog[];

        let filteredLogs = allLogs;

        if (since) {
          filteredLogs = filteredLogs.filter((log) => new Date(log.t).getTime() >= since);
        }

        if (sessionId) {
          filteredLogs = filteredLogs.filter((log) => log.sid === sessionId);
        }

        if (contextType !== 'all') {
          filteredLogs = filteredLogs.filter((log) => {
            if (log.ctx === contextType) {
              return true;
            }
            return contextType === 'background' && log.ctx === 'service_worker';
          });
        }

        if (logLevel !== 'all') {
          filteredLogs = filteredLogs.filter((log) => log.level === logLevel);
        }

        const sorted = [...filteredLogs].sort((a, b) => {
          const aTime = new Date(a.t).getTime();
          const bTime = new Date(b.t).getTime();
          return aTime - bTime;
        });

        return sorted.slice(0, maxEntries);
      } catch (_error) {
        return { error: _error instanceof Error ? _error.message : String(_error) };
      }
    }, params);

    if (!Array.isArray(logs)) {
      const errorMessage =
        'error' in (logs as Record<string, unknown>)
          ? String((logs as Record<string, unknown>).error)
          : 'Unknown error retrieving logs';
      await fs.writeFile(outputPath, `Failed to retrieve logs: ${errorMessage}\n`, 'utf8');
      return;
    }

    const getBadgeSnapshot = async () => {
      if (!options.targetUrl) {
        return '';
      }

      const snapshot = await tempPage.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({ url });
        const results = await Promise.all(
          tabs.map(async (tab) => ({
            id: tab.id ?? null,
            text:
              typeof tab.id === 'number'
                ? await chrome.action.getBadgeText({ tabId: tab.id })
                : null,
          }))
        );
        return results;
      }, options.targetUrl);

      const lines = (snapshot as Array<{ id: number | null; text: string | null }>).map((entry) => {
        return `Tab ${entry.id ?? 'unknown'} badge: ${entry.text ?? '<null>'}`;
      });

      return `Badge snapshot for ${options.targetUrl}:\n${lines.join('\n')}\n\n`;
    };

    if (logs.length === 0) {
      const badgeTextLine = await getBadgeSnapshot();

      await fs.writeFile(outputPath, `${badgeTextLine}No logs captured.\n`, 'utf8');
      return;
    }

    const groupedBySession = new Map<string, ExtensionLog[]>();
    for (const log of logs) {
      const sessionLogs = groupedBySession.get(log.sid) ?? [];
      sessionLogs.push(log);
      groupedBySession.set(log.sid, sessionLogs);
    }

    let output = '';
    for (const [sessionId, sessionLogs] of groupedBySession) {
      output += `Session: ${sessionId}\n`;
      output += `${'─'.repeat(50)}\n`;
      output += sessionLogs.map(formatLog).join('\n');
      output += '\n\n';
    }

    const badgeSnapshot = await getBadgeSnapshot();
    output = `${badgeSnapshot}${output}`;

    await fs.writeFile(outputPath, output.trimEnd() + '\n', 'utf8');
  } finally {
    await tempPage.close();
    if (originalPage) {
      await originalPage.bringToFront();
    }
  }
}
