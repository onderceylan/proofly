import { afterEach, describe, expect, it } from 'vitest';

import { getExtensionContext } from './extension-context.ts';

const globalRef = globalThis as Record<string, unknown>;
const originalWindow = globalRef.window;
const originalServiceWorkerScope = (globalRef as Record<string, unknown>).ServiceWorkerGlobalScope;

function setWindowHref(href?: string) {
  if (href) {
    globalRef.window = {
      location: { href },
    } as unknown as Window;
  } else {
    delete globalRef.window;
  }
}

function resetGlobals() {
  if (originalWindow === undefined) {
    delete globalRef.window;
  } else {
    globalRef.window = originalWindow;
  }

  if (originalServiceWorkerScope === undefined) {
    delete (globalRef as Record<string, unknown>).ServiceWorkerGlobalScope;
  } else {
    (globalRef as Record<string, unknown>).ServiceWorkerGlobalScope = originalServiceWorkerScope;
  }
}

afterEach(() => {
  delete (globalRef as Record<string, unknown>).ServiceWorkerGlobalScope;
  delete globalRef.window;
  resetGlobals();
});

describe('getExtensionContext', () => {
  it('returns background when ServiceWorkerGlobalScope exists', () => {
    (globalRef as Record<string, unknown>).ServiceWorkerGlobalScope = class {};
    delete globalRef.window;

    expect(getExtensionContext()).toBe('background');
  });

  it('detects popup pages by URL', () => {
    setWindowHref('chrome-extension://proofly/popup/index.html');
    expect(getExtensionContext()).toBe('popup');
  });

  it('detects options pages by URL', () => {
    setWindowHref('chrome-extension://proofly/options/index.html');
    expect(getExtensionContext()).toBe('options');
  });

  it('detects sidebar pages by URL segment', () => {
    setWindowHref('chrome-extension://proofly/sidepanel/view.html');
    expect(getExtensionContext()).toBe('sidebar');
  });

  it('detects devtools pages by URL segment', () => {
    setWindowHref('chrome-extension://proofly/devtools/index.html');
    expect(getExtensionContext()).toBe('devtools');
  });

  it('falls back to content-script when no conditions match', () => {
    setWindowHref('https://example.com');
    expect(getExtensionContext()).toBe('content-script');
  });
});
