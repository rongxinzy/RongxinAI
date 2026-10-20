import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const outDir = process.env.SCREENSHOT_OUT || '/opt/cursor/artifacts/screenshots';
const baseUrl = process.env.PREVIEW_URL || 'http://127.0.0.1:5176';
const states = ['populated', 'empty', 'error'];
function usageTabs(lang) {
  if (lang === 'zh') {
    return [
      ['routing', '路由组'],
      ['quota', '配额'],
      ['calls', '调用记录'],
      ['cost', '费用'],
    ];
  }
  return [
    ['routing', 'Routing groups'],
    ['quota', 'Quota'],
    ['calls', 'Call log'],
    ['cost', 'Cost'],
  ];
}
const langs = [
  ['en', { locale: 'en-US' }],
  ['zh', { locale: 'zh-CN' }],
];

async function waitForServer(url, ms = 60_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Preview server not ready at ${url}`);
}

async function openModelRouting(page, lang) {
  await page.getByText('Login', { exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('button', { name: lang === 'zh' ? '模型' : 'Model', exact: true }).click();
  await page
    .getByRole('tab', { name: lang === 'zh' ? '路由与用量' : 'Routing & usage', exact: true })
    .click();
}

async function shot(page, name) {
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
}

mkdirSync(outDir, { recursive: true });

let child;
if (!process.env.PREVIEW_URL) {
  child = spawn('bun', ['run', 'web:preview'], { cwd: process.cwd(), stdio: 'pipe' });
}

try {
  await waitForServer(baseUrl);
  const browser = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    for (const [lang, contextOptions] of langs) {
      for (const state of states) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          colorScheme: scheme,
          ...contextOptions,
        });
        const page = await context.newPage();
        await page.goto(`${baseUrl}/?previewSkipBoot=1&previewMagpieUsage=${state}`, {
          waitUntil: 'domcontentloaded',
        });
        await openModelRouting(page, lang);
        for (const [tabId, tabLabel] of usageTabs(lang)) {
          await page.getByRole('tab', { name: tabLabel, exact: true }).click();
          await page.waitForTimeout(400);
          await shot(page, `model-usage-${state}-${tabId}-${lang}-${scheme}`);
        }
        await context.close();
      }
    }
  }
  const narrow = await browser.newPage({
    viewport: { width: 1000, height: 800 },
    colorScheme: 'light',
  });
  await narrow.goto(`${baseUrl}/?previewSkipBoot=1&previewMagpieUsage=populated`, {
    waitUntil: 'domcontentloaded',
  });
  await openModelRouting(narrow, 'en');
  await narrow.getByRole('combobox').first().click();
  await narrow.getByRole('option', { name: 'Routing & usage' }).click();
  await shot(narrow, 'model-usage-populated-routing-narrow-light-en');
  await narrow.close();
  await browser.close();
} finally {
  child?.kill('SIGTERM');
}
