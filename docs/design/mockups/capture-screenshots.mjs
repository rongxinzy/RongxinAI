#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const mockupDir = path.dirname(new URL(import.meta.url).pathname);
const outDir = '/opt/cursor/artifacts/model-market-redesign';

const files = fs
  .readdirSync(mockupDir)
  .filter(f => f.endsWith('.html') && !f.startsWith('_'));

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

for (const file of files.sort()) {
  const filePath = path.join(mockupDir, file);
  await page.goto(`file://${filePath}`, { waitUntil: 'load' });
  const pngName = file.replace('.html', '.png');
  await page.screenshot({ path: path.join(outDir, pngName), fullPage: true });
  console.log('screenshot', pngName);
}

await browser.close();
