const DEV_SIDE_PANEL_BUTTON_ID = 'proofly-dev-sidepanel-button';

interface DevButtonOptions {
  isDev?: boolean;
  documentRoot?: Document;
}

export async function installDevSidepanelButton(options?: DevButtonOptions): Promise<void> {
  const isDev = options?.isDev ?? import.meta.env.DEV;
  if (!isDev) {
    return;
  }

  const root = options?.documentRoot ?? document;

  if (root.getElementById(DEV_SIDE_PANEL_BUTTON_ID)) {
    return;
  }

  await import('./components/sidepanel-toggle-button.ts');

  const button = root.createElement('prfly-sidepanel-toggle');
  button.id = DEV_SIDE_PANEL_BUTTON_ID;
  root.body.appendChild(button);
}

export { DEV_SIDE_PANEL_BUTTON_ID };
