#!/usr/bin/env node
// Captures light/dark screenshots of the main screens from a running `bun run web:preview`.
// Usage: bun run web:preview & bun run preview:screenshots [outDir] (default: preview-screenshots/)
// Requires a Playwright Chromium: `bunx playwright install chromium`.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.PREVIEW_URL ?? 'http://localhost:5176/';
const outDir = path.resolve(process.argv[2] ?? 'preview-screenshots');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const pageErrors = [];
try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      colorScheme: scheme,
      deviceScaleFactor: Number(process.env.PREVIEW_DPR ?? 2),
    });
    page.on('pageerror', error => pageErrors.push(`${scheme}: ${error.message}`));
    const shot = name => page.screenshot({ path: path.join(outDir, `${name}-${scheme}.png`) });
    const settle = () => page.waitForTimeout(1500);

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    // Wait for fixture-backed content, not just the skeleton.
    await page.getByText('Calculator', { exact: true }).first().waitFor({ timeout: 60_000 });
    await settle();
    await shot('workbench');

    await page.getByText('Build a React calculator app').first().click();
    await settle();
    await shot('chat');

    await page.getByText('Login', { exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await settle();
    await shot('settings-general');

    await page.getByText('Appearance', { exact: true }).first().click();
    await settle();
    await shot('settings-appearance');

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByText('Calculator', { exact: true }).first().waitFor({ timeout: 60_000 });
    await page.getByText('Automation', { exact: true }).first().click();
    await page.getByText('Daily sales digest').first().waitFor({ timeout: 30_000 });
    await settle();
    await shot('scheduled-tasks');

    await page.getByText('New Task', { exact: true }).first().click();
    await page.getByText('Calculator', { exact: true }).first().waitFor({ timeout: 30_000 });
    await settle();
    const plus = page.getByRole('button', { name: 'Files & Images' }).first();
    await plus.click();
    await page.getByText('Skills', { exact: true }).first().click();
    await page.getByText('Manage Skills', { exact: true }).click();
    await page.getByText('Word documents').first().waitFor({ timeout: 30_000 });
    await settle();
    await shot('skills');

    await page.keyboard.press('Escape');
    await page.getByText('New Task', { exact: true }).first().click();
    await settle();
    await page.getByRole('button', { name: 'Files & Images' }).first().click();
    await page.getByRole('menuitem', { name: 'Connectors' }).hover();
    await page.getByRole('menuitem', { name: 'Manage Connectors' }).click();
    await page.getByRole('heading', { name: 'Connectors' }).waitFor({ timeout: 30_000 });
    await page.getByRole('tab', { name: /^Installed/ }).click();
    await page.getByText('Filesystem', { exact: true }).waitFor({ timeout: 30_000 });
    await settle();
    await shot('mcp');
    await page.close();
  }
} finally {
  await browser.close();
}

if (pageErrors.length > 0) {
  console.error(`[preview:screenshots] uncaught page errors:\n${pageErrors.join('\n')}`);
  process.exit(1);
}
console.log(`[preview:screenshots] saved to ${outDir}`);
