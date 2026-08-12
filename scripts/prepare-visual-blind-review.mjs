#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Cannot read ${file}: ${error.message}`);
  }
}

function parseArgs(args) {
  const [root, ...rest] = args;
  if (!root) fail('Usage: prepare-visual-blind-review.mjs <evaluation-root> [--seed <seed>] [--output <dir>]');
  const seedIndex = rest.indexOf('--seed');
  const outputIndex = rest.indexOf('--output');
  const seed = seedIndex >= 0 ? rest[seedIndex + 1] : 'visual-review-v1';
  const output = outputIndex >= 0 ? rest[outputIndex + 1] : path.join(root, 'blind-review');
  if (!seed || !output) fail('--seed and --output require values');
  return { root: path.resolve(root), seed, output: path.resolve(output) };
}

function loadVariant(taskDir, name) {
  const file = path.join(taskDir, `${name}.json`);
  const data = readJson(file);
  if (!data || typeof data !== 'object' || typeof data.preview !== 'string' || !data.preview) fail(`${file} requires a preview path`);
  if (typeof data.kind !== 'string' || !data.kind) fail(`${file} requires kind`);
  const preview = path.resolve(taskDir, data.preview);
  if (!fs.existsSync(preview)) fail(`${file} preview does not exist: ${data.preview}`);
  const extension = path.extname(preview).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) fail(`${file} preview must be a rendered PNG, JPG, JPEG, or WebP`);
  return { kind: data.kind, preview, extension };
}

function chooseOrder(seed, taskId) {
  const byte = crypto.createHash('sha256').update(`${seed}:${taskId}`).digest()[0];
  return byte % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
}

const { root, seed, output } = parseArgs(process.argv.slice(2));
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail(`Evaluation root does not exist: ${root}`);
const taskNames = fs.readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name !== path.basename(output))
  .map(entry => entry.name)
  .sort();
if (taskNames.length === 0) fail('Evaluation root must contain task directories');
if (fs.existsSync(output) && fs.readdirSync(output).length > 0) fail(`Refusing to overwrite non-empty output directory: ${output}`);

fs.mkdirSync(path.join(output, 'artifacts'), { recursive: true });
const reviewerTasks = [];
const keyTasks = [];

for (const taskId of taskNames) {
  const taskDir = path.join(root, taskId);
  const variants = { baseline: loadVariant(taskDir, 'baseline'), candidate: loadVariant(taskDir, 'candidate') };
  if (variants.baseline.kind !== variants.candidate.kind) fail(`${taskId} baseline and candidate must use the same kind`);
  const orderedSources = chooseOrder(seed, taskId);
  const choices = orderedSources.map((source, index) => {
    const label = index === 0 ? 'A' : 'B';
    const sourceVariant = variants[source];
    const destination = path.join(output, 'artifacts', `${taskId}-${label}${sourceVariant.extension}`);
    fs.copyFileSync(sourceVariant.preview, destination);
    return { label, preview: path.relative(output, destination) };
  });
  reviewerTasks.push({ taskId, kind: variants.baseline.kind, choices, rubric: ['direction', 'composition', 'color-and-type', 'coherence', 'legibility-or-responsiveness'], winner: null, notes: '' });
  keyTasks.push({ taskId, A: orderedSources[0], B: orderedSources[1] });
}

fs.writeFileSync(path.join(output, 'review-form.json'), `${JSON.stringify({ schemaVersion: 1, instructions: 'Review each A/B pair without opening the source task directory. Pick one winner or tie, then score the listed dimensions 1–5 and explain any score below 4.', tasks: reviewerTasks }, null, 2)}\n`);
fs.writeFileSync(path.join(output, 'blind-review-key.json'), `${JSON.stringify({ schemaVersion: 1, seed, tasks: keyTasks }, null, 2)}\n`);
console.log(`Prepared ${taskNames.length} blinded visual review pair(s) in ${output}`);
