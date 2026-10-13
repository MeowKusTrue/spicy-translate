import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = 18788;
export default defineConfig({
  testDir: 'e2e',
  // system Chrome by default (no browser download); PW_CHANNEL= (empty) uses Playwright's bundled chromium
  use: { baseURL: `http://127.0.0.1:${PORT}`, acceptDownloads: true, channel: process.env.PW_CHANNEL ?? 'chrome' },
  // serves the built dist/index.html (npm run e2e builds first); state goes to a temp dir
  webServer: {
    command: 'node server/index.ts --http',
    url: `http://127.0.0.1:${PORT}/api/project`,
    env: { SPICY_PORT: String(PORT), SPICY_DIR: path.join(os.tmpdir(), 'spicy-e2e-' + Date.now()) },
    reuseExistingServer: false,
  },
});
