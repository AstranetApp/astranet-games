// Real-runtime Chromium smoke configuration. The official artifact must be
// prepared first; no DOM-only runtime stub is accepted here.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'taisei.spec.js',
  timeout: 180_000,
  expect: { timeout: 120_000 },
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:8198',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'node start-server.mjs',
    url: 'http://127.0.0.1:8198/healthz',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
