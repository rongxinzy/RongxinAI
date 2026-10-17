import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

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
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.015,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  use: {
    baseURL: `http://127.0.0.1:${previewPort}/`,
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
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
