#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const skillRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const exampleRoot = path.join(skillRoot, 'examples', 'minimal');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'presentation-studio-test-'));
fs.cpSync(exampleRoot, workspace, { recursive: true });
const validator = path.join(skillRoot, 'scripts', 'validate-deck.mjs');
const run = () => spawnSync(process.execPath, [validator, path.join(workspace, 'deck.json'), '--strict'], { encoding: 'utf8' });

try {
  const valid = run();
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);

  const pagePath = path.join(workspace, 'pages', '01-cover.json');
  const page = JSON.parse(fs.readFileSync(pagePath, 'utf8'));
  page.elements[0].fontSize = 10;
  fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  const invalid = run();
  assert.equal(invalid.status, 1, 'strict validation must block an unreadable font size');
  assert.match(invalid.stdout, /below the 18px minimum/);
  console.log('Presentation Studio validator tests passed');
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
