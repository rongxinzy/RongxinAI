import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

import { PREVIEW_LOCALE, PREVIEW_VIEWPORT } from './shared/constants.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const previewPort = Number(process.env.PREVIEW_PORT ?? 5176);

export default defineConfig({
  testDir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'tests'),
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${previewPort}/`,
    locale: PREVIEW_LOCALE,
    viewport: PREVIEW_VIEWPORT,
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `bun run web:preview -- --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: `http://127.0.0.1:${previewPort}/`,
    cwd: root,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_DEV_PORT: String(previewPort),
    },
  },
});
