import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: pkg.displayName,
  short_name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  offline_enabled: true,
  minimum_chrome_version: '141',
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAghEbt/+ZI7NKopGGQC4PewsWckFdNInsNhQkhwsOR/Grpsi99fqTiT2A36FrK3vOE+81wQ85earudkXmrsOpBk3HkhtnjeyRxXymv3u4Vs65eqrGWaKqv3AN60zQ/Of1gXbkoIkoNh2+UcP5EI3eXyDN75QQvual1Q+Gui85Q60U1wKLMUl6kTA7nYjZeE5hGoM4sQJz8r26V9moMneJkX3tadIkG0oO/MgzZdb8a/IlAjAlkSxNFim6W0zb1HtOZLDzCdCYrF53v67C4HxrUn+BwXe+pNqsPl0gc05I/qr724p3cJNFrDKbebbpjI+kEIfw4cxirBqWCIG/RD3R4wIDAQAB',
  icons: {
    48: 'logo-square.png',
  },
  action: {
    default_title: 'Click to open issues panel',
    default_icon: {
      48: 'logo-square.png',
    },
  },
  background: {
    service_worker: 'src/background/main.ts',
    type: 'module',
  },
  content_scripts: [
    {
      js: ['src/content/polyfills/webcomponents.ts'],
      matches: ['<all_urls>'],
      run_at: 'document_start',
    },
    {
      js: ['src/content/main.ts'],
      matches: ['<all_urls>'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['sidePanel', 'tabs', 'storage', 'contextMenus'],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  options_page: 'src/options/index.html',
  // @ts-ignore
  trial_tokens: [
    // ProofReader API origin trial token
    // Expires at May 19, 2026
    'AqbneTXpW3PvrSZJFd2dK6cKzMR+ToiFz/Kygf0e0vbyRJ0ZW4Pd9wGQlG2atibBZGr5sxDN4RAYJi4clyDlkwcAAABxeyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vb2lhaWNta25oYnBuaG5nZGVwcGVnbmhvYm5sZWVvbG0iLCJmZWF0dXJlIjoiQUlQcm9vZnJlYWRlckFQSSIsImV4cGlyeSI6MTc3OTE0ODgwMH0=',
  ],
});
