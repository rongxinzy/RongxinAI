#!/usr/bin/env node
// Visits every browser-preview screen in light and dark, exercises the main
// interactions, and fails if the page logs an error or throws.
// Usage: bun run web:preview:check
// Requires Playwright Chromium: bunx playwright install chromium
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
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
const outDir = path.resolve(
  process.argv[2] ?? process.env.PREVIEW_OUT ?? '.github/pr-assets/browser-preview',
);
const artifactDir = process.env.PREVIEW_ARTIFACT_DIR ?? '/opt/cursor/artifacts/browser-preview';

const settingsTabs = [
  ['settings-general', 'General'],
  ['settings-appearance', 'Appearance'],
  ['settings-shortcuts', 'Shortcuts'],
  ['settings-model', 'Model'],
  ['settings-platform-models', 'Platform Models'],
  ['settings-model-routing', 'Model Routing'],
  ['settings-memory', 'Memory'],
  ['settings-im', 'IM Bot'],
  ['settings-email', 'Email'],
  ['settings-about', 'About'],
];

const sidebarViews = [
  ['local-inference', 'Local Inference'],
  ['coding', 'Coding'],
  ['todo', 'Todo'],
  ['scheduled-tasks', 'Automation', 'Daily sales digest'],
  ['activity', 'Activity', '正在查询'],
  ['expert', 'Expert'],
];

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

function waitForOwnServer(server, url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const fail = message => {
      reject(new Error(`${message}\n${server.logs()}`));
    };
    const onExit = code => fail(`preview exited with ${code} before ${url} was ready`);
    server.once('exit', onExit);
    const tick = () => {
      if (server.exitCode !== null) return;
      const request = http.get(url, response => {
        response.resume();
        server.off('exit', onExit);
        resolve();
      });
      request.on('error', () => {
        if (Date.now() - started > timeoutMs) fail(`preview did not start at ${url}`);
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

async function shot(page, outDirForScheme, name) {
  await settle(page);
  await page.screenshot({ path: path.join(outDirForScheme, name) });
}

async function home(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText('Calculator', { exact: true }).first().waitFor({ timeout: 60_000 });
}

async function openSkills(page) {
  await page.getByRole('button', { name: 'Files & Images' }).first().click();
  await page.getByText('Skills', { exact: true }).first().click();
  await page.getByText('Manage Skills', { exact: true }).click();
  await page.getByText('Word documents').first().waitFor({ timeout: 30_000 });
}

async function openConnectors(page) {
  await page.getByRole('button', { name: 'Files & Images' }).first().click();
  await page.getByRole('menuitem', { name: 'Connectors' }).hover();
  await page.getByRole('menuitem', { name: 'Manage Connectors' }).click();
  await page.getByRole('heading', { name: 'Connectors' }).waitFor({ timeout: 30_000 });
  await page.getByRole('tab', { name: /^Installed/ }).click();
  await page.getByText('Filesystem', { exact: true }).waitFor({ timeout: 30_000 });
}

async function walk(browser, scheme, out, failures) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: scheme,
    locale: 'en-US',
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(20_000);
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('favicon')) return;
    failures.push(`${scheme} console: ${text}`);
  });
  page.on('pageerror', error => {
    failures.push(`${scheme} pageerror: ${error.message}`);
  });
  const failedBefore = () => failures.filter(item => item.startsWith(`${scheme} `)).length;

  const step = async (name, action) => {
    const before = failedBefore();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      failures.push(`${scheme} ${name}: ${message}`);
    }
    if (failedBefore() > before) {
      try {
        await home(page);
      } catch {
        // The next step reports its own navigation failure.
      }
    }
  };

  try {
    await step('workbench', async () => {
      await home(page);
      await shot(page, out, `workbench-${scheme}.png`);
    });
    await step('chat', async () => {
      await page.getByText('Build a React calculator app').first().click();
      await page.getByText('Scaffold a').first().waitFor({ timeout: 20_000 });
      await shot(page, out, `chat-${scheme}.png`);
    });
    await step('stream', async () => {
      // The session composer is a contenteditable div (role=textbox), not a textarea.
      const input = page.getByRole('textbox').last();
      await input.click();
      await page.keyboard.type('Add a percent key');
      await page.keyboard.press('Enter');
      await page.getByText('Browser preview reply is ready').waitFor({ timeout: 20_000 });
      await shot(page, out, `chat-stream-${scheme}.png`);
    });
    await step('chat mode', async () => {
      await page.getByRole('switch', { name: 'Work / Chat' }).click();
      await page.getByText('Draft a weekly update').first().waitFor({ timeout: 20_000 });
      await shot(page, out, `chat-mode-${scheme}.png`);
      await page.getByRole('switch', { name: 'Work / Chat' }).click();
      await page.getByText('Calculator', { exact: true }).first().waitFor();
    });
    await step('settings', async () => {
      await page.getByText('Login', { exact: true }).first().click();
      await page.getByRole('menuitem', { name: 'Settings' }).click();
      for (const [name, label] of settingsTabs) {
        await page.getByRole('button', { name: label, exact: true }).first().click();
        await shot(page, out, `${name}-${scheme}.png`);
      }
    });
    await step('sidebar', async () => {
      await page.getByRole('button', { name: 'New Task', exact: true }).click();
      await page.getByText('Calculator', { exact: true }).first().waitFor();
      for (const [name, label, ready] of sidebarViews) {
        await page.getByRole('button', { name: label, exact: true }).click();
        if (ready) await page.getByText(ready).first().waitFor({ timeout: 20_000 });
        await shot(page, out, `${name}-${scheme}.png`);
      }
    });
    await step('skills', async () => {
      await page.getByRole('button', { name: 'New Task', exact: true }).click();
      await openSkills(page);
      await shot(page, out, `skills-${scheme}.png`);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByText('Upload folder', { exact: true }).click();
      await page.getByText('Word documents').first().waitFor();
    });
    await step('connectors', async () => {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'New Task', exact: true }).click();
      await openConnectors(page);
      await shot(page, out, `mcp-${scheme}.png`);
    });
    await step('dialogs', async () => {
      const problem = await page.evaluate(async () => {
        const directory = await window.electron.dialog.selectDirectory();
        const file = await window.electron.dialog.selectFile();
        const box = await window.electron.dialog.showMessageBox({ message: 'Preview' });
        if (!directory.success || directory.path !== '/home/user/projects/preview')
          return 'selectDirectory';
        if (!file.success || !file.path) return 'selectFile';
        if (box.response !== 0) return 'showMessageBox';
        return '';
      });
      if (problem) throw new Error(problem);
    });
    await step('model log', async () => {
      await page.goto(
        `${baseUrl}?view=llamacpp-model-launch-log&sessionId=preview-log&modelName=preview-model`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.getByText('preview model server listening').waitFor({ timeout: 20_000 });
      await shot(page, out, `model-launch-log-${scheme}.png`);
    });
  } finally {
    await page.close();
  }
}

mkdirSync(outDir, { recursive: true });
const ownServer = !explicitUrl;
const server = ownServer ? startPreview() : undefined;
const failures = [];
let browser;
try {
  if (server) await waitForOwnServer(server, baseUrl, 60_000);
  else await waitForHttp(baseUrl, 60_000);
  browser = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    await walk(browser, scheme, outDir, failures);
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  if (server) console.error(server.logs());
} finally {
  await browser?.close();
  if (server) {
    server.kill('SIGTERM');
    await new Promise(resolve => {
      server.on('exit', resolve);
      setTimeout(resolve, 2_000);
    });
  }
}

try {
  mkdirSync(artifactDir, { recursive: true });
  cpSync(outDir, artifactDir, { recursive: true });
} catch (error) {
  console.warn(
    `[web:preview:check] could not copy screenshots to ${artifactDir}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

if (failures.length > 0) {
  console.error(`[web:preview:check] ${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`[web:preview:check] passed, screenshots in ${outDir}`);
