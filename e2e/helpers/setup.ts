import puppeteer, { type Browser } from 'puppeteer-core';
import path from 'path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'url';
import { spawn } from 'node:child_process';
import { beforeAll, afterAll } from 'vitest';
import { resetExtensionStorage } from './fixtures';
import { writeExtensionLogsToFile } from './log-writer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const EXTENSION_ID = 'oiaicmknhbpnhngdeppegnhobnleeolm';

let globalBrowser: Browser | null = null;

export function getBrowser(): Browser {
  if (!globalBrowser) {
    throw new Error('Browser not initialized. Make sure setup has run.');
  }
  return globalBrowser;
}

function isWatchMode(): boolean {
  return process.env.TEST_WATCH_MODE === 'true';
}

async function reloadExtension(browser: Browser): Promise<void> {
  try {
    console.log('🔄 Reloading extension...');

    const page = await browser.newPage();
    await page.goto(`chrome://extensions/?id=${EXTENSION_ID}`);

    await page.waitForSelector('extensions-manager', { timeout: 5000 });

    await page.evaluate(() => {
      const extensionsManager = document.querySelector('extensions-manager');
      if (!extensionsManager?.shadowRoot) return;

      const extensionsItemList = extensionsManager.shadowRoot.querySelector('extensions-item-list');
      if (!extensionsItemList?.shadowRoot) return;

      const extensionsItem = extensionsItemList.shadowRoot.querySelector('extensions-item');
      if (!extensionsItem?.shadowRoot) return;

      const reloadButton = extensionsItem.shadowRoot.querySelector(
        '#dev-reload-button'
      ) as HTMLElement;
      if (reloadButton) {
        reloadButton.click();
      }
    });

    console.log('✅ Extension reloaded');

    await page.close();

    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (_error) {
    console.log('⚠️  Could not reload extension:', _error);
  }
}

beforeAll(async () => {
  console.log('🚀 Starting browser setup...');

  const extensionPath = path.join(__dirname, '../../dev');
  console.log(`Loading extension from: ${extensionPath}`);

  const userDataDir = path.join(homedir(), '.cache/chrome-devtools-mcp/chrome-profile-canary');
  console.log(`Using profile: ${userDataDir}`);

  const watchMode = isWatchMode();
  const chromeLaunchArgs = [
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    `--user-data-dir=${userDataDir}`,
    '--hide-crash-restore-bubble',
  ];

  if (watchMode) {
    console.log('⏸️  Watch mode: attempting to connect to or spawn Chrome');

    const debugPort = 9222;

    try {
      globalBrowser = await puppeteer.connect({
        browserURL: `http://localhost:${debugPort}`,
      });
      console.log('✅ Connected to existing Chrome instance');
    } catch (_error) {
      console.log('🚀 Spawning new detached Chrome process');

      const chromeArgs = [...chromeLaunchArgs, `--remote-debugging-port=${debugPort}`];

      const chromeProcess = spawn(
        '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
        chromeArgs,
        {
          detached: true,
          stdio: 'ignore',
        }
      );

      chromeProcess.unref();

      console.log(`🔓 Chrome spawned as detached process (PID: ${chromeProcess.pid})`);

      await new Promise((resolve) => setTimeout(resolve, 3000));

      globalBrowser = await puppeteer.connect({
        browserURL: `http://localhost:${debugPort}`,
      });

      console.log('✅ Puppeteer connected to new Chrome instance');
    }
  } else {
    globalBrowser = await puppeteer.launch({
      channel: 'chrome-dev',
      headless: false,
      ignoreDefaultArgs: true,
      args: chromeLaunchArgs,
    });

    console.log('✅ Browser launched successfully');
  }

  if (globalBrowser) {
    const page = await globalBrowser.newPage();
    await page.goto(`chrome-extension://${EXTENSION_ID}/src/options/index.html`, {
      waitUntil: 'networkidle0',
    });
    await resetExtensionStorage(page);
    await reloadExtension(globalBrowser);
  }
});

afterAll(async () => {
  const watchMode = isWatchMode();

  if (globalBrowser) {
    try {
      console.log('Writing logs to e2e/logs.txt');
      await writeExtensionLogsToFile(globalBrowser, EXTENSION_ID, {
        targetUrl: 'http://localhost:8080/test.html',
      });
    } catch (_error) {
      console.log('⚠️  Failed to write extension logs:', _error);
    }
  }

  if (watchMode) {
    console.log('⏸️  Watch mode - keeping browser open for inspection');
    console.log('💡 Close all browser windows to terminate');
    if (globalBrowser) {
      globalBrowser.disconnect();
      console.log('✅ Browser disconnected (still running)');
    }
  } else {
    console.log('🧹 Running browser teardown...');
    if (globalBrowser) {
      await globalBrowser.close();
      globalBrowser = null;
      console.log('✅ Browser closed');
    }
  }
});
