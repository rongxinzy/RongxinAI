#!/usr/bin/env node
/**
 * Regenerate the case-library thumbnails in public/case-previews/.
 *
 * Two kinds of sources feed one output directory:
 *   - scripts/case-previews/*.html  cover mockups for cases that produce an
 *     artifact but ship no live template (slides, sheets, reports, documents)
 *   - SKILLs/frontend-design/templates/*.html  the live case templates themselves
 *
 * Every page is rendered at 1100x688 (the card aspect) and downscaled to
 * 800x500, which is what the gallery actually needs: the card slot is about
 * 350px wide. WebP encoding uses the browser canvas so no image toolchain is
 * required.
 *
 * Usage: npm run generate:case-previews
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, '..');
const coverDir = join(scriptDir, 'case-previews');
const templateDir = join(projectRoot, 'SKILLs', 'frontend-design', 'templates');
const outputDir = join(projectRoot, 'public', 'case-previews');
const cataloguePath = join(projectRoot, 'public', 'quick-actions.json');

const VIEWPORT = { width: 1100, height: 688 };
const OUTPUT_WIDTH = 800;
const OUTPUT_HEIGHT = 500;
const WEBP_QUALITY = 0.8;

const WINDOWS_BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

async function launchBrowser() {
  const attempts = [{}, ...WINDOWS_BROWSER_PATHS.map(executablePath => ({ executablePath }))];
  let lastError = null;

  for (const options of attempts) {
    try {
      return await chromium.launch(options);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Unable to launch a browser for preview rendering. Install Playwright browsers with "npx playwright install chromium" or install Chrome/Edge. Last error: ${lastError?.message}`,
  );
}

function collectSources() {
  const sources = [];

  for (const file of readdirSync(coverDir).sort()) {
    if (file.endsWith('.html')) {
      sources.push({ name: file.replace(/\.html$/, ''), path: join(coverDir, file) });
    }
  }

  for (const file of readdirSync(templateDir).sort()) {
    if (file.endsWith('.html')) {
      sources.push({ name: file.replace(/\.html$/, ''), path: join(templateDir, file) });
    }
  }

  return sources;
}

async function encodeWebp(context, pngBuffer) {
  const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

  return context.evaluate(
    async ({ source, width, height, quality }) => {
      const image = new Image();
      await new Promise((res, rej) => {
        image.onload = res;
        image.onerror = rej;
        image.src = source;
      });

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, width, height);

      return canvas.toDataURL('image/webp', quality).split(',')[1];
    },
    { source: dataUrl, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, quality: WEBP_QUALITY },
  );
}

function removeStalePreviews(rendered) {
  const removed = [];

  for (const file of readdirSync(outputDir)) {
    if (!file.endsWith('.webp') || rendered.has(file)) continue;

    rmSync(join(outputDir, file));
    removed.push(file);
  }

  return removed;
}

/**
 * Every case that declares a preview in public/quick-actions.json must have a
 * rendered file, otherwise the gallery silently falls back to a text-only card.
 */
function findMissingPreviews(rendered) {
  const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
  const missing = new Set();

  for (const action of catalogue.actions ?? []) {
    for (const prompt of action.prompts ?? []) {
      if (!prompt.preview) continue;

      const name = prompt.preview.replace(/^\.\/case-previews\//, '');
      if (!rendered.has(name)) missing.add(name);
    }
  }

  return [...missing];
}

async function main() {
  const sources = collectSources();
  if (!sources.length) {
    throw new Error('No preview sources found to render.');
  }

  mkdirSync(outputDir, { recursive: true });

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const encoderContext = await browser.newPage();

  const rendered = new Set();
  let totalBytes = 0;
  try {
    for (const source of sources) {
      await page.goto(pathToFileURL(source.path).href);
      // Entry transitions (700ms) and the scroll count-up tween (900ms) must
      // finish, otherwise the card captures half-animated numbers.
      await page.waitForTimeout(1500);

      const png = await page.screenshot();
      const webp = await encodeWebp(encoderContext, png);
      const buffer = Buffer.from(webp, 'base64');

      writeFileSync(join(outputDir, `${source.name}.webp`), buffer);
      rendered.add(`${source.name}.webp`);
      totalBytes += buffer.length;
      console.log(`${source.name}.webp ${(buffer.length / 1024).toFixed(1)} KB`);
    }
  } finally {
    await browser.close();
  }

  const removed = removeStalePreviews(rendered);
  console.log(
    `Rendered ${sources.length} previews into public/case-previews (${(totalBytes / 1024).toFixed(1)} KB).`,
  );

  if (removed.length) {
    console.log(`Removed ${removed.length} stale preview(s): ${removed.join(', ')}`);
  }

  const missing = findMissingPreviews(rendered);
  if (missing.length) {
    throw new Error(
      `public/quick-actions.json references ${missing.length} preview(s) with no source: ${missing.join(', ')}`,
    );
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
