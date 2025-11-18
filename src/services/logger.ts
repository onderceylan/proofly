import pino from 'pino';
import { getExtensionContext } from './extension-context.ts';
import { serializeMessage } from '../shared/utils/serialize.ts';

// Generate session ID for development logging
const generateSessionId = (): string => {
  return `dev_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

const sessionId = generateSessionId();

interface DevLogEntry {
  t: number | string;
  ctx: string;
  level: string;
  msg: string[];
  data?: Record<string, unknown>;
  sid: string;
}

let logQueue: DevLogEntry[] = [];
let isFlushScheduled = false;
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
let sessionInitialized = false;

const checkChromeStorageAvailable = (): boolean => {
  try {
    return (
      typeof chrome !== 'undefined' &&
      typeof chrome.storage !== 'undefined' &&
      typeof chrome.storage.local !== 'undefined'
    );
  } catch {
    return false;
  }
};

const flushLogsToStorage = async (): Promise<void> => {
  if (logQueue.length === 0) {
    isFlushScheduled = false;
    return;
  }

  if (!checkChromeStorageAvailable()) {
    console.warn('proofly - chrome.storage not available, queued logs:', logQueue.length);
    isFlushScheduled = false;
    return;
  }

  const logsToFlush = [...logQueue];
  logQueue = [];
  isFlushScheduled = false;

  try {
    const result = await chrome.storage.local.get('__dev_logs');
    const existingLogs = Array.isArray(result.__dev_logs)
      ? (result.__dev_logs as DevLogEntry[])
      : [];
    let logs: DevLogEntry[] = existingLogs.slice();

    if (!sessionInitialized) {
      const currentContext = logsToFlush[0]?.ctx;
      if (currentContext) {
        logs = logs.filter((log) => !(log.ctx === currentContext && log.sid !== sessionId));
      }
      sessionInitialized = true;
    }

    logs.push(...logsToFlush);

    if (logs.length > 1000) {
      logs.splice(0, logs.length - 1000);
    }

    await chrome.storage.local.set({ __dev_logs: logs });
  } catch (error) {
    console.error('proofly - Failed to flush logs:', error, 'Lost logs:', logsToFlush.length);
    logQueue.unshift(...logsToFlush);
  }
};

const scheduleFlush = () => {
  if (isFlushScheduled) {
    return;
  }

  isFlushScheduled = true;

  if (flushTimeout) {
    clearTimeout(flushTimeout);
  }

  flushTimeout = setTimeout(() => {
    flushLogsToStorage().catch((err) => {
      console.error('proofly - Flush error:', err);
    });
  }, 100);
};

const devLogSink = (logEvent: Record<string, any>): void => {
  try {
    const structuredData: Record<string, unknown> = { ...logEvent };
    delete structuredData.messages;
    delete structuredData.bindings;
    delete structuredData.level;
    delete structuredData.ts;

    const timestampSource = logEvent.ts;
    const numericTimestamp =
      typeof timestampSource === 'number'
        ? timestampSource
        : typeof timestampSource === 'string'
          ? Number(timestampSource)
          : Number.NaN;
    const parsedTimestamp = Number.isFinite(numericTimestamp)
      ? numericTimestamp
      : typeof timestampSource === 'string'
        ? Date.parse(timestampSource)
        : Number.NaN;

    const entry: DevLogEntry = {
      t: Number.isFinite(parsedTimestamp) ? parsedTimestamp : String(timestampSource ?? ''),
      ctx: logEvent.bindings?.[0]?.context || 'unknown',
      level: logEvent.level?.label ?? 'info',
      msg: Array.isArray(logEvent.messages)
        ? logEvent.messages.map((message: unknown) => serializeMessage(message))
        : [],
      data: Object.keys(structuredData).length > 0 ? structuredData : undefined,
      sid: sessionId,
    };

    logQueue.push(entry);
    scheduleFlush();
  } catch (error) {
    console.error('proofly - Error queuing log:', error);
  }
};

const isDevelopment = import.meta.env.MODE === 'development';

export const p = pino({
  browser: {
    asObject: true,
    serialize: true,
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => {
        // Prepend 'proofly - ' prefix to all log messages
        if ('msg' in object) {
          if (typeof object.msg === 'string') {
            object.msg = `proofly - ${object.msg}`;
          } else if (Array.isArray(object.msg)) {
            object.msg = object.msg.map((m: any) => (typeof m === 'string' ? `proofly - ${m}` : m));
          }
        }
        return object;
      },
    },
    ...(isDevelopment && {
      transmit: {
        level: 'info',
        send: function (_level, logEvent) {
          devLogSink(logEvent);
        },
      },
    }),
  },
  level: isDevelopment ? 'debug' : 'error',
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const logger = p.child({ context: getExtensionContext() });
