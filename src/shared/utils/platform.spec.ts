import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlatform, isMacOS } from './platform.ts';

const originalNavigator = globalThis.navigator;

function mockNavigator(platform: string | undefined) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      userAgentData: platform
        ? {
            platform,
          }
        : undefined,
    },
  });
}

describe('platform utils', () => {
  beforeEach(() => {
    mockNavigator('macOS');
  });

  it('detects macOS via userAgentData', () => {
    expect(isMacOS()).toBe(true);
    expect(getPlatform()).toBe('macos');
  });

  it('falls back to unknown when hints unavailable', () => {
    mockNavigator(undefined);
    expect(isMacOS()).toBe(false);
    expect(getPlatform()).toBe('unknown');
  });
});

afterAll(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});
