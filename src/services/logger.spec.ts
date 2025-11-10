import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ExtensionContext } from './extension-context.ts';

async function importLogger(options?: { mode?: string; context?: ExtensionContext }) {
  vi.resetModules();
  vi.stubEnv('MODE', options?.mode ?? 'test');

  const childLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const childMock = vi.fn().mockReturnValue(childLogger);
  const rootLogger = { child: childMock };

  const pinoFn = vi.fn().mockReturnValue(rootLogger);
  (pinoFn as any).stdTimeFunctions = { isoTime: vi.fn() };

  vi.doMock('pino', () => ({ default: pinoFn }));
  vi.doMock('./extension-context.ts', () => ({
    getExtensionContext: vi.fn().mockReturnValue(options?.context ?? 'content-script'),
  }));

  const module = await import('./logger.ts');
  const config = pinoFn.mock.calls[0][0];
  return { module, config, childMock, childLogger, pinoFn };
}

afterEach(() => {
  vi.doUnmock('pino');
  vi.doUnmock('./extension-context.ts');
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('logger service', () => {
  it('binds logger child to the resolved extension context', async () => {
    const { module, childMock, childLogger } = await importLogger({ context: 'options' });
    expect(childMock).toHaveBeenCalledWith({ context: 'options' });
    expect(module.logger).toBe(childLogger);
  });

  it('prefixes log messages through the browser formatter', async () => {
    const { config } = await importLogger();
    const formatter = config.browser.formatters.log;

    const stringMessage = formatter({ msg: 'Ready' });
    expect(stringMessage.msg).toBe('proofly - Ready');

    const arrayMessage = formatter({ msg: ['Init', 123] });
    expect(arrayMessage.msg[0]).toBe('proofly - Init');
    expect(arrayMessage.msg[1]).toBe(123);
  });

  it('only configures dev log transmit in development mode', async () => {
    const nonDev = await importLogger({ mode: 'test' });
    expect(nonDev.config.browser.transmit).toBeUndefined();

    const dev = await importLogger({ mode: 'development' });
    expect(dev.config.browser.transmit).toBeDefined();
    expect(dev.config.browser.transmit.level).toBe('info');
  });
});
