#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleRoot = path.join(skillRoot, 'examples', 'minimal');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'presentation-studio-test-'));
fs.cpSync(exampleRoot, workspace, { recursive: true });
const validator = path.join(skillRoot, 'scripts', 'validate-deck.mjs');
const run = () => spawnSync(process.execPath, [validator, path.join(workspace, 'deck.json'), '--strict'], { encoding: 'utf8' });
const compiler = path.join(skillRoot, 'scripts', 'compile-deck.mjs');

try {
  const valid = run();
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);

  const pagePath = path.join(workspace, 'pages', '01-cover.json');
  const page = JSON.parse(fs.readFileSync(pagePath, 'utf8'));
  page.elements[0].fontSize = 10;
  fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  const invalid = run();
  assert.equal(invalid.status, 1, 'strict validation must block an unreadable font size');
  assert.match(invalid.stdout, /below the 18pt minimum/);

  page.elements = [
    { id: 'cover-title', type: 'text', bounds: [96, 96, 860, 100], style: '$title', text: 'Metrics at a glance', wrap: true },
    { id: 'metrics', type: 'table', bounds: [96, 240, 500, 180], rows: [['Metric', 'Result'], ['Revenue', '42%']], fontSize: 18 },
    { id: 'trend', type: 'chart', chartType: 'bar', bounds: [640, 240, 500, 220], data: [{ name: 'Growth', labels: ['Q1', 'Q2'], values: [18, 42] }] },
  ];
  fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  const validStructuredDeck = run();
  assert.equal(validStructuredDeck.status, 0, validStructuredDeck.stdout + validStructuredDeck.stderr);
  const outputPath = path.join(workspace, 'output', 'structured.pptx');
  const compiled = spawnSync(process.execPath, [compiler, path.join(workspace, 'deck.json'), outputPath], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  assert.ok(fs.statSync(outputPath).size > 0, 'compiler must create a non-empty PPTX for tables and charts');
  console.log('Presentation Studio validator tests passed');
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
