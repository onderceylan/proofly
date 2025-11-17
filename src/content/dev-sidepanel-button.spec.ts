import { describe, expect, it, vi } from 'vitest';
import { installDevSidepanelButton, DEV_SIDE_PANEL_BUTTON_ID } from './dev-sidepanel-button.ts';
import { createMockDocument } from '../test/helpers/mock-dom.ts';

vi.mock('./components/sidepanel-toggle-button.ts', () => ({}));

describe('installDevSidepanelButton', () => {
  it('does not inject button when not running in dev mode', async () => {
    const testDoc = createMockDocument();

    await installDevSidepanelButton({
      isDev: false,
      documentRoot: testDoc as unknown as Document,
    });

    expect(testDoc.getElementById(DEV_SIDE_PANEL_BUTTON_ID)).toBeNull();
  });

  it('injects button once when in dev mode', async () => {
    const testDoc = createMockDocument();

    await installDevSidepanelButton({
      isDev: true,
      documentRoot: testDoc as unknown as Document,
    });
    await installDevSidepanelButton({
      isDev: true,
      documentRoot: testDoc as unknown as Document,
    });

    const button = testDoc.getElementById(DEV_SIDE_PANEL_BUTTON_ID);
    expect(button).not.toBeNull();
    expect(button?.id).toBe(DEV_SIDE_PANEL_BUTTON_ID);
  });
});
