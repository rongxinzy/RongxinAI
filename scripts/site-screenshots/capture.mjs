#!/usr/bin/env node
// Captures the official-site app screenshots from the browser preview with the
// site demo data (`?previewScenario=site`, src/renderer/browserMock/siteDemo/).
// For every screen it writes, under --out (a rongxinxzyai-pages checkout):
//   <name>.png        1280×800 at 2x, the fallback and social-preview image
//   <name>.html       static HTML snapshot: no JS, matched CSS only, subset fonts
//   <name>-<w>.webp   Showcase cards only, the widths Showcase.tsx requests
// Usage: node scripts/site-screenshots/capture.mjs --out ../rongxinxzyai-pages [--url http://127.0.0.1:5176/]
// Requires Playwright Chromium, fontconfig and Python fontTools + brotli.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { collectPlatformFonts, embedFonts } from './fonts.mjs';
import { serializeScreen } from './snapshot-page.mjs';

const { values: args } = parseArgs({
  options: { out: { type: 'string' }, url: { type: 'string' }, only: { type: 'string' } },
});
if (!args.out) throw new Error('--out <rongxinxzyai-pages checkout> is required');

const VIEWPORT = { width: 1280, height: 800 };
const LABELS = {
  zh: {
    localInference: '本地推理',
    localModels: '本地模型',
    marketplace: '模型市场',
    expert: '专家',
    skills: '技能',
    login: '登录',
    settings: '设置',
    model: '模型',
    addProvider: '添加渠道',
    report: '撰写第三季度销售分析报告',
  },
  en: {
    localInference: 'Local Inference',
    localModels: 'Local Models',
    marketplace: 'Marketplace',
    expert: 'Expert',
    skills: 'Skills',
    login: 'Login',
    settings: 'Settings',
    model: 'Model',
    addProvider: 'Add provider',
    report: 'Write the Q3 sales analysis report',
  },
};
const FORBIDDEN = [
  /magpie/i,
  /yetone/i,
  /preview model/i,
  /lorem/i,
  /\b(foo|dummy|asdf)\b/i,
  /sk-[a-z0-9]{8,}/i,
  /企业版/,
  /enterprise edition/i,
];

const SCREENS = [
  {
    id: 'conversation',
    files: { showcase: 'zhiyuan-conversation', widths: [976, 1464, 1952, 2440] },
    open: openConversation,
  },
  {
    id: 'model-market',
    files: {
      showcase: 'zhiyuan-model-market',
      widths: [976, 1464, 1952, 2440],
      docs: 'local-inference/model-marketplace',
    },
    open: openMarketplace,
  },
  {
    id: 'skills',
    files: { showcase: 'zhiyuan-skills', widths: [640, 1184, 1776, 2440] },
    open: openSkills,
  },
  {
    id: 'workspace',
    files: {
      showcase: 'zhiyuan-workspace',
      widths: [640, 1184, 1776, 2440],
      docs: 'quick-start/work-page',
    },
    open: async () => {},
  },
  { id: 'chat', files: { docs: 'quick-start/chat-shortcuts' }, open: openChat },
  {
    id: 'select-model',
    files: { docs: 'local-inference/select-local-model' },
    open: openModelPicker,
  },
  { id: 'local-models', files: { docs: 'local-inference/local-models' }, open: openLocalModels },
  { id: 'provider', files: { docs: 'model/provider-settings' }, open: openProviderDialog },
  { id: 'expert', files: { docs: 'skills/expert-page' }, open: openExpert },
];

async function settle(page, ms = 900) {
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(ms);
}

async function openConversation(page, L) {
  await page.getByText(L.report, { exact: true }).first().click();
  await page.getByText('Q3-sales-report.docx').first().waitFor({ timeout: 20_000 });
  await settle(page, 1200);
  // Frame the prompt and the executed steps from the top. A wheel scroll unpins
  // the transcript from the bottom the same way a user would.
  await page.mouse.move(620, 300);
  await page.mouse.wheel(0, -4000);
  await settle(page, 800);
  // The jump-to-latest button floats over the answer once unpinned; hide it.
  await page.evaluate(() => {
    for (const button of document.querySelectorAll('button')) {
      const parent = button.offsetParent;
      if (
        getComputedStyle(button).position !== 'absolute' &&
        getComputedStyle(button.parentElement).position !== 'absolute'
      )
        continue;
      if (button.textContent.trim() || !parent?.className.toString().includes('overflow-y-hidden'))
        continue;
      button.style.visibility = 'hidden';
    }
  });
}

async function openLocalInference(page, L, tab) {
  await page.getByText(L.localInference, { exact: true }).first().click();
  await settle(page, 600);
  await page.getByRole('tab', { name: tab, exact: true }).first().click();
}

async function openMarketplace(page, L) {
  await openLocalInference(page, L, L.marketplace);
  await page
    .getByText(/Qwen3.8B/)
    .locator('visible=true')
    .first()
    .waitFor({ timeout: 20_000 });
  await settle(page, 1500);
}

async function openLocalModels(page, L) {
  await openLocalInference(page, L, L.localModels);
  await page
    .getByText(/Qwen3.8B/)
    .locator('visible=true')
    .first()
    .waitFor({ timeout: 20_000 });
}

async function openExpert(page, L) {
  await page.getByText(L.expert, { exact: true }).first().click();
  await settle(page, 1200);
}

async function openSkills(page, L) {
  await openExpert(page, L);
  await page.getByRole('tab', { name: L.skills, exact: true }).first().click();
  await settle(page, 1200);
}

async function openChat(page) {
  await page.getByRole('switch').first().click();
}

async function openModelPicker(page) {
  await page.getByRole('button', { name: 'Qwen3 8B' }).first().click();
}

async function openProviderDialog(page, L) {
  await page.getByText(L.login, { exact: true }).first().click();
  await page.getByRole('menuitem', { name: L.settings }).click();
  await settle(page, 600);
  await page.getByRole('button', { name: L.model, exact: true }).first().click();
  await settle(page, 600);
  await page.getByRole('button', { name: L.addProvider }).first().click();
  const dialog = page.getByRole('dialog').first();
  await dialog.getByRole('combobox').first().click();
  await page
    .getByRole('option', { name: /DeepSeek/ })
    .first()
    .click();
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitForHttp(url, timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () =>
      http
        .get(url, res => {
          res.resume();
          resolve();
        })
        .on('error', () =>
          Date.now() - started > timeoutMs
            ? reject(new Error(`no preview at ${url}`))
            : setTimeout(tick, 400),
        );
    tick();
  });
}

// Image work runs in Chromium so the script needs no native image libraries.
async function webpEncoder(browser) {
  const page = await browser.newPage();
  return async (png, width) => {
    const dataUrl = await page.evaluate(
      async ([b64, w]) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = w;
        c.height = Math.round((img.naturalHeight * w) / img.naturalWidth);
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/webp', 0.86);
      },
      [png.toString('base64'), width],
    );
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  };
}

function targets(screen, lang) {
  const out = [];
  const en = lang === 'en';
  if (screen.files.showcase)
    out.push({
      kind: 'showcase',
      base: path.join('public/product', `${screen.files.showcase}${en ? '-en' : ''}`),
    });
  if (screen.files.docs)
    out.push({
      kind: 'docs',
      base: path.join(en ? 'docs/en/assets/guide' : 'docs/assets/guide', screen.files.docs),
    });
  return out;
}

async function main() {
  let server;
  let baseUrl = args.url;
  if (!baseUrl) {
    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}/`;
    server = spawn(
      'bunx',
      [
        'vite',
        '--config',
        'vite.config.browser.ts',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort',
      ],
      { stdio: 'ignore' },
    );
  }
  await waitForHttp(baseUrl);
  const outRoot = path.resolve(args.out);
  const browser = await chromium.launch();
  const encodeWebp = await webpEncoder(browser);
  const report = [];
  const only = args.only ? new Set(args.only.split(',')) : null;
  try {
    for (const lang of ['zh', 'en']) {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 2,
        locale: lang === 'zh' ? 'zh-CN' : 'en-US',
        colorScheme: 'light',
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      for (const screen of SCREENS) {
        if (only && !only.has(screen.id)) continue;
        await page.goto(
          `${baseUrl}?previewScenario=site&previewLocale=${lang === 'zh' ? 'zh-CN' : 'en-US'}`,
          { waitUntil: 'domcontentloaded' },
        );
        await page
          .getByText(LABELS[lang].localInference, { exact: true })
          .first()
          .waitFor({ timeout: 60_000 });
        await settle(page, 1500);
        await screen.open(page, LABELS[lang]);
        if (screen.id !== 'select-model' && screen.id !== 'provider') {
          await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
          await page.evaluate(
            () => document.activeElement instanceof HTMLElement && document.activeElement.blur(),
          );
        }
        await settle(page, 1000);
        const visible = await page.evaluate(() => document.body.innerText);
        const hit = FORBIDDEN.find(re => re.test(visible));
        if (hit) throw new Error(`${screen.id}/${lang}: visible text matches ${hit}`);
        const png = await page.screenshot({ type: 'png' });
        const stacks = await collectPlatformFonts(page);
        const snap = await page.evaluate(serializeScreen);
        const { html, fontBytes } = embedFonts(
          snap.html
            .replace(/<meta charset="[^"]*">|<meta name="viewport"[^>]*>/gi, '')
            .replace(
              '<head>',
              '<head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=1280">',
            ),
          snap.text,
          stacks,
        );
        for (const target of targets(screen, lang)) {
          const base = path.join(outRoot, target.base);
          mkdirSync(path.dirname(base), { recursive: true });
          writeFileSync(`${base}.png`, png);
          writeFileSync(`${base}.html`, html);
          if (target.kind === 'showcase') {
            for (const width of screen.files.widths)
              writeFileSync(`${base}-${width}.webp`, await encodeWebp(png, width));
          }
          report.push(
            `${target.base}: png ${(png.length / 1024).toFixed(0)} KB, html ${(html.length / 1024).toFixed(0)} KB (fonts ${(fontBytes / 1024).toFixed(0)} KB)`,
          );
        }
      }
      if (errors.length) console.warn(`[${lang}] page errors:\n${errors.join('\n')}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server?.kill();
  }
  console.log(report.join('\n'));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
