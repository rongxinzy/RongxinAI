#!/usr/bin/env node
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

const prefix = process.argv[2] ?? 'before';
const outDir = path.resolve(process.env.UNSLOP_OUT ?? '/opt/cursor/artifacts/unslop');
const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}/?previewSkipBoot=1`;
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
  return spawn(
    'bun',
    ['run', 'web:preview', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, VITE_DEV_PORT: String(port) },
    },
  );
}

mkdirSync(outDir, { recursive: true });
const server = startPreview();
try {
  await waitForHttp(baseUrl, 120_000);
  const browser = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport,
      colorScheme: scheme,
      locale: 'en-US',
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText('Calculator', { exact: true }).first().waitFor({ timeout: 90_000 });
    await page.waitForTimeout(800);
    const suffix = scheme === 'dark' ? 'dark' : 'light';
    await page.screenshot({ path: path.join(outDir, `${prefix}-main-${suffix}.png`) });
    await page.close();
  }
  await browser.close();
  console.log(`[unslop-capture] wrote ${prefix} screenshots to ${outDir}`);
} finally {
  server.kill('SIGTERM');
}
