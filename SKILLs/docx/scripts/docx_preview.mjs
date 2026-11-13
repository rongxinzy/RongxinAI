#!/usr/bin/env node
/**
 * Preview DOCX content as plain text (cross-platform Node.js).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatSize(bytes) {
  const units = ['B', 'K', 'M', 'G', 'T'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return idx === 0 ? `${value}B` : `${value.toFixed(1)}${units[idx]}`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error(`Usage: ${path.basename(process.argv[1] || 'docx_preview.mjs')} <file.docx>`);
    console.error('Preview DOCX content as plain text.');
    process.exit(1);
  }

  const inputPath = args[0];
  if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isFile()) {
    console.error(`Error: File not found: ${inputPath}`);
    process.exit(1);
  }

  const fileSize = formatSize(fs.statSync(inputPath).size);
  console.log(`=== DOCX Preview: ${path.basename(inputPath)} ===`);
  console.log(`File size: ${fileSize}`);

  const content = execFileSync(
    process.execPath,
    [path.join(__dirname, 'docx_to_text.mjs'), inputPath],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
    },
  ).trim();

  const words = content ? content.split(/\s+/).filter(Boolean).length : 0;
  const estPages = Math.floor((words + 249) / 250);
  console.log(`Word count: ${words}`);
  console.log(`Estimated pages: ${estPages}`);
  console.log('---');
  if (content) {
    console.log(content);
  }
}

main();
