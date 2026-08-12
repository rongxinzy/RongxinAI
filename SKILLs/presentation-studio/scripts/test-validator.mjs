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
    { id: 'metrics', type: 'table', bounds: [96, 240, 500, 180], rows: [['Metric', 'Result'], ['Revenue', '42%']], fontSize: 18, headerFill: '$primary', headerColor: '$background', borderColor: '$muted' },
    { id: 'trend', type: 'chart', chartType: 'bar', bounds: [640, 240, 500, 220], data: [{ name: 'Growth', labels: ['Q1', 'Q2'], values: [18, 42] }] },
  ];
  fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  const validStructuredDeck = run();
  assert.equal(validStructuredDeck.status, 0, validStructuredDeck.stdout + validStructuredDeck.stderr);
  const outputPath = path.join(workspace, 'output', 'structured.pptx');
  const compiled = spawnSync(process.execPath, [compiler, path.join(workspace, 'deck.json'), outputPath], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  assert.ok(fs.statSync(outputPath).size > 0, 'compiler must create a non-empty PPTX for tables and charts');

  page.elements = [
    { id: 'mask', type: 'shape', shape: 'rect', bounds: [96, 96, 500, 280], fill: '$primary', fillTransparency: 35, decorative: true },
    { id: 'gradient', type: 'shape', shape: 'rect', bounds: [96, 96, 500, 280], gradient: { from: '$primary', to: '$secondary', direction: 'horizontal', steps: 8 }, decorative: true },
    { id: 'divider', type: 'shape', shape: 'line', bounds: [96, 410, 500, 1], line: '$accent', lineWidth: 1.5, decorative: true },
    { id: 'table-style', type: 'table', bounds: [96, 440, 500, 180], rows: [['Metric', 'Result'], ['Revenue', '42%']], fontSize: 18, headerFill: '$secondary', headerColor: '$background', borderColor: '$muted' },
    { id: 'comparison', type: 'chart', chartType: 'bar', bounds: [640, 240, 500, 220], data: [{ name: 'Plan', labels: ['Q1', 'Q2'], values: [18, 42] }, { name: 'Actual', labels: ['Q1', 'Q2'], values: [12, 36] }], colors: ['$series1', '$series2'] },
  ];
  fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  const validVisualPrimitives = run();
  assert.equal(validVisualPrimitives.status, 0, validVisualPrimitives.stdout + validVisualPrimitives.stderr);
  const visualOutputPath = path.join(workspace, 'output', 'visual-primitives.pptx');
  const visualCompiled = spawnSync(process.execPath, [compiler, path.join(workspace, 'deck.json'), visualOutputPath], { encoding: 'utf8' });
  assert.equal(visualCompiled.status, 0, visualCompiled.stdout + visualCompiled.stderr);
  assert.ok(fs.statSync(visualOutputPath).size > 0, 'compiler must preserve visual primitives as editable PowerPoint elements');

  delete page.elements[4].colors;
  fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  const invalidMultiSeriesChart = run();
  assert.equal(invalidMultiSeriesChart.status, 1, 'multi-series charts must not silently become monochrome');
  assert.match(invalidMultiSeriesChart.stdout, /one explicit color per series/);

  page.elements = [{ id: 'edge-ornament', type: 'shape', shape: 'ellipse', bounds: [-40, 60, 180, 180], fill: '$accent', decorative: true, allowOverflow: true }];
  fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  const validOverflowOrnament = run();
  assert.equal(validOverflowOrnament.status, 0, validOverflowOrnament.stdout + validOverflowOrnament.stderr);

  delete page.elements[0].allowOverflow;
  fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  const invalidOverflowOrnament = run();
  assert.equal(invalidOverflowOrnament.status, 1, 'decorative overflow requires an explicit opt-in');
  assert.match(invalidOverflowOrnament.stdout, /element exceeds canvas bounds/);

  // Overflow errors must state the concrete deficit (px and lines), not just the symptom.
  page.elements = [
    { id: 'tight', type: 'text', bounds: [96, 96, 500, 50], fontSize: 24, text: '这是一段用于验证溢出报错差额的信息内容', wrap: true },
  ];
  fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  const overflowDelta = run();
  assert.equal(overflowDelta.status, 1, 'overflow must still block export');
  assert.match(overflowDelta.stdout, /overflows its height by \d+px/, 'overflow error must carry a px deficit');
  assert.match(overflowDelta.stdout, /about \d+ line\(s\)/, 'overflow error must carry a line deficit');

  // A page whose rendered text area exceeds the usable canvas must be reported
  // as a structural budget error, so the model reduces content instead of tweaking bounds.
  page.elements = [
    { id: 'wall-1', type: 'text', bounds: [96, 96, 500, 700], fontSize: 36, text: '资'.repeat(120), wrap: true, allowOverlap: true, allowUnderfill: true },
    { id: 'wall-2', type: 'text', bounds: [96, 96, 500, 700], fontSize: 36, text: '资'.repeat(120), wrap: true, allowOverlap: true, allowUnderfill: true },
    { id: 'wall-3', type: 'text', bounds: [96, 96, 500, 700], fontSize: 36, text: '资'.repeat(120), wrap: true, allowOverlap: true, allowUnderfill: true },
  ];
  fs.writeFileSync(pagePath, `${JSON.stringify(page, null, 2)}\n`);
  const budgetOverflow = run();
  assert.equal(budgetOverflow.status, 1, 'an over-budget page must block export');
  assert.match(budgetOverflow.stdout, /canvas budget/, 'over-budget pages must be reported structurally');
  assert.match(budgetOverflow.stdout, /bounds adjustments cannot fix this/, 'budget error must steer away from bounds tweaking');

  console.log('Presentation Studio validator tests passed');
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
