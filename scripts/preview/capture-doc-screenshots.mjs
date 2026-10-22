#!/usr/bin/env node
// Capture documentation screenshots at 1280×800 for docs/theme-previews/.
// Usage: bun run preview:doc-screenshots
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const chosen = typeof address === 'object' && address ? address.port : 0;
      probe.close(error => (error ? reject(error) : resolve(chosen)));
    });
  });
}

const explicitUrl = process.env.PREVIEW_URL;
const explicitPort = process.env.PREVIEW_PORT;
const port = explicitUrl ? 0 : explicitPort ? Number(explicitPort) : await reservePort();
const baseUrl = explicitUrl ?? `http://127.0.0.1:${port}/`;
const outDir = path.resolve(process.env.DOC_PREVIEW_OUT ?? 'docs/theme-previews');
const dateTag = process.env.DOC_PREVIEW_DATE ?? '2026-10-22';
const viewport = { width: 1280, height: 800 };

function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const request = http.get(url, response => {
        response.resume();
        resolve();
      });
      request.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error(`preview did not start at ${url}`));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

function startPreview() {
  const server = spawn(
    'bun',
    ['run', 'web:preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, VITE_DEV_PORT: String(port) },
    },
  );
  let logs = '';
  server.stdout?.on('data', chunk => {
    logs += chunk.toString();
  });
  server.stderr?.on('data', chunk => {
    logs += chunk.toString();
  });
  server.logs = () => logs;
  return server;
}

async function settle(page) {
  await page.waitForTimeout(700);
}

async function shot(page, fileName) {
  await settle(page);
  await page.screenshot({ path: path.join(outDir, fileName) });
}

async function home(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Calculator', { exact: true }).first().waitFor({ timeout: 60_000 });
}

async function openSettings(page, tabLabel) {
  await page.getByText('Login', { exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('button', { name: tabLabel, exact: true }).first().click();
}

async function captureScheme(browser, scheme) {
  const page = await browser.newPage({
    viewport,
    colorScheme: scheme,
    locale: 'en-US',
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(30_000);
  const suffix = scheme === 'dark' ? 'dark' : 'light';

  try {
    await home(page);
    await shot(page, `main-interface-${dateTag}-${suffix}.png`);

    await openSettings(page, 'Appearance');
    await shot(page, `appearance-settings-${suffix}.png`);

    await openSettings(page, 'Platform Models');
    await shot(page, `provider-model-selection-${dateTag}-${suffix}.png`);

    await page.getByRole('button', { name: 'New Task', exact: true }).click();
    await page.getByText('Calculator', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Local Inference', exact: true }).click();
    await page.getByRole('heading', { name: 'Local Inference' }).waitFor({ timeout: 30_000 });
    await shot(page, `local-inference-${dateTag}-${suffix}.png`);
  } finally {
    await page.close();
  }
}

mkdirSync(outDir, { recursive: true });
const ownServer = !explicitUrl;
const server = ownServer ? startPreview() : undefined;

try {
  if (ownServer) {
    await waitForHttp(baseUrl, 120_000);
    await new Promise((resolve, reject) => {
      const fail = () => reject(new Error(`preview exited early\n${server.logs()}`));
      server.once('exit', fail);
      waitForHttp(baseUrl, 120_000)
        .then(() => {
          server.off('exit', fail);
          resolve();
        })
        .catch(reject);
    });
  }

  const browser = await chromium.launch();
  try {
    await captureScheme(browser, 'light');
    await captureScheme(browser, 'dark');
  } finally {
    await browser.close();
  }
  console.log(`[preview:doc-screenshots] wrote screenshots to ${outDir} (${dateTag})`);
} finally {
  if (server) server.kill('SIGTERM');
}
