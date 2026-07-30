#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const HEX = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_TYPES = new Set(['text', 'shape', 'image']);

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Cannot parse ${file}: ${error.message}`);
  }
}

function isBounds(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite);
}

function intersects(a, b) {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}

function resolveColor(value, colors) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('$')) return colors[value.slice(1)] ?? null;
  return value;
}

function textMetrics(text, fontSize, width, lineHeight, wrap) {
  const chars = [...String(text)];
  const estimatedWidth = chars.reduce((sum, char) => sum + (/[^\x00-\x7F]/.test(char) ? fontSize : fontSize * 0.55), 0);
  const lines = wrap === false ? 1 : Math.max(1, Math.ceil(estimatedWidth / Math.max(width, 1)));
  return { width: estimatedWidth, height: lines * fontSize * Math.max(lineHeight ?? 1.3, 1.3), lines };
}

function validateDeck(deckPath) {
  const deck = readJson(deckPath);
  const errors = [];
  const warnings = [];
  const add = (level, message, page) => (level === 'error' ? errors : warnings).push({ level, page, message });
  const baseDir = path.dirname(deckPath);
  const canvas = deck.canvas;
  if (!canvas || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height) || canvas.width <= 0 || canvas.height <= 0) {
    add('error', 'canvas.width and canvas.height must be positive numbers');
    return { deck, errors, warnings };
  }
  if (!Array.isArray(deck.pages) || deck.pages.length === 0) add('error', 'deck.pages must contain at least one page');
  const colors = deck.theme?.colors ?? {};
  for (const [name, value] of Object.entries(colors)) if (!HEX.test(value)) add('error', `theme color ${name} is not a #RRGGBB color`);
  const styles = deck.theme?.textStyles ?? {};
  const globalIds = new Set();
  const safeMargin = Number.isFinite(deck.safeMargin) ? deck.safeMargin : 36;

  for (const [index, pageRef] of (deck.pages ?? []).entries()) {
    const pageLabel = `${index + 1}:${pageRef}`;
    if (typeof pageRef !== 'string') { add('error', 'page reference must be a string', pageLabel); continue; }
    const pagePath = path.resolve(baseDir, pageRef);
    if (!fs.existsSync(pagePath)) { add('error', 'page file does not exist', pageLabel); continue; }
    const page = readJson(pagePath);
    if (!Array.isArray(page.elements)) { add('error', 'page.elements must be an array', pageLabel); continue; }
    const textElements = [];
    for (const element of page.elements) {
      const label = `${pageLabel}:${element?.id ?? '<missing-id>'}`;
      if (!element?.id || typeof element.id !== 'string') { add('error', 'element id is required', label); continue; }
      if (globalIds.has(element.id)) add('error', 'element id must be unique across the deck', label);
      globalIds.add(element.id);
      if (!ALLOWED_TYPES.has(element.type)) { add('error', `unsupported element type ${element.type}`, label); continue; }
      if (!isBounds(element.bounds) || element.bounds[2] <= 0 || element.bounds[3] <= 0) { add('error', 'bounds must be [x, y, width, height] with positive size', label); continue; }
      const [x, y, width, height] = element.bounds;
      if (!element.decorative && (x < safeMargin || y < safeMargin || x + width > canvas.width - safeMargin || y + height > canvas.height - safeMargin)) add('warning', `element breaches ${safeMargin}px safe margin`, label);
      if (x < 0 || y < 0 || x + width > canvas.width || y + height > canvas.height) add('error', 'element exceeds canvas bounds', label);
      if (element.type === 'image') {
        if (typeof element.src !== 'string' || !element.src) add('error', 'image src is required', label);
        else if (/^https?:\/\//.test(element.src)) add('error', 'remote image URLs are not allowed; download the verified asset into assets/', label);
        else if (!fs.existsSync(path.resolve(baseDir, element.src))) add('error', `image asset not found: ${element.src}`, label);
      }
      if (element.type === 'shape' && !resolveColor(element.fill ?? '$background', colors)) add('error', 'shape fill must be a valid theme reference or #RRGGBB color', label);
      if (element.type === 'text') {
        const style = element.style?.startsWith('$') ? styles[element.style.slice(1)] ?? {} : {};
        const fontSize = element.fontSize ?? style.fontSize;
        if (!Number.isFinite(fontSize)) add('error', 'text requires fontSize or a valid text style', label);
        else {
          const minimum = element.role === 'caption' ? 12 : 18;
          if (fontSize < minimum) add('error', `font size ${fontSize}px is below the ${minimum}px minimum`, label);
          const metrics = textMetrics(element.text, fontSize, width, element.lineHeight ?? style.lineHeight, element.wrap);
          if (element.wrap === false && metrics.width > width) add('error', 'single-line text overflows its width', label);
          if (metrics.height > height) add('error', 'text overflows its height', label);
          if (height > metrics.height * 3 && !element.allowUnderfill) add('warning', 'text box is substantially underfilled; tighten bounds or improve composition', label);
        }
        const color = resolveColor(element.color ?? style.color ?? '$text', colors);
        if (!HEX.test(color ?? '')) add('error', 'text color must resolve to #RRGGBB', label);
        textElements.push(element);
      }
    }
    for (let i = 0; i < textElements.length; i += 1) for (let j = i + 1; j < textElements.length; j += 1) {
      if (!textElements[i].allowOverlap && !textElements[j].allowOverlap && intersects(textElements[i].bounds, textElements[j].bounds)) add('error', `text overlaps ${textElements[j].id}`, `${pageLabel}:${textElements[i].id}`);
    }
  }
  return { deck, errors, warnings };
}

const [deckPath, ...args] = process.argv.slice(2);
if (!deckPath) fail('Usage: validate-deck.mjs <deck.json> [--strict] [--json <report.json>]');
const strict = args.includes('--strict');
const jsonIndex = args.indexOf('--json');
const reportPath = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
const result = validateDeck(path.resolve(deckPath));
const report = { deck: path.resolve(deckPath), errors: result.errors, warnings: result.warnings, summary: { errors: result.errors.length, warnings: result.warnings.length } };
if (reportPath) { fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true }); fs.writeFileSync(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`); }
for (const issue of [...report.errors, ...report.warnings]) console.log(`${issue.level.toUpperCase()} ${issue.page ? `[${issue.page}] ` : ''}${issue.message}`);
console.log(`Summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings`);
process.exitCode = report.summary.errors > 0 || (strict && report.summary.warnings > 0) ? 1 : 0;
