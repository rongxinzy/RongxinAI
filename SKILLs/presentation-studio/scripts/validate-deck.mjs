#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const HEX = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_TYPES = new Set(['text', 'shape', 'image', 'table', 'chart']);
const ALLOWED_SIZING = new Set(['cover', 'contain']);
const ALLOWED_CHART_TYPES = new Set(['area', 'bar', 'doughnut', 'line', 'pie', 'radar']);
const ALLOWED_GRADIENT_DIRECTIONS = new Set(['horizontal', 'vertical']);

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

function isTransparency(value) {
  return value === undefined || (Number.isFinite(value) && value >= 0 && value <= 100);
}

function textMetrics(text, fontSize, width, lineHeight, wrap) {
  const fontPixels = fontSize * (96 / 72);
  const chars = [...String(text)];
  const estimatedWidth = chars.reduce((sum, char) => sum + (/[^\x00-\x7F]/.test(char) ? fontPixels : fontPixels * 0.55), 0);
  const lines = wrap === false ? 1 : Math.max(1, Math.ceil(estimatedWidth / Math.max(width, 1)));
  return { width: estimatedWidth, height: lines * fontPixels * Math.max(lineHeight ?? 1.3, 1.3), lines };
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
    const background = resolveColor(page.background ?? '$background', colors);
    if (!HEX.test(background ?? '')) add('error', 'page background must resolve to #RRGGBB', pageLabel);
    const textElements = [];
    let pageTextArea = 0;
    for (const element of page.elements) {
      const label = `${pageLabel}:${element?.id ?? '<missing-id>'}`;
      if (!element?.id || typeof element.id !== 'string') { add('error', 'element id is required', label); continue; }
      if (globalIds.has(element.id)) add('error', 'element id must be unique across the deck', label);
      globalIds.add(element.id);
      if (!ALLOWED_TYPES.has(element.type)) { add('error', `unsupported element type ${element.type}`, label); continue; }
      if (!isBounds(element.bounds) || element.bounds[2] <= 0 || element.bounds[3] <= 0) { add('error', 'bounds must be [x, y, width, height] with positive size', label); continue; }
      const [x, y, width, height] = element.bounds;
      if (!element.decorative && (x < safeMargin || y < safeMargin || x + width > canvas.width - safeMargin || y + height > canvas.height - safeMargin)) add('warning', `element breaches ${safeMargin}px safe margin`, label);
      const exceedsCanvas = x < 0 || y < 0 || x + width > canvas.width || y + height > canvas.height;
      if (exceedsCanvas && !(element.decorative && element.allowOverflow)) add('error', 'element exceeds canvas bounds', label);
      if (element.type === 'image') {
        if (typeof element.src !== 'string' || !element.src) add('error', 'image src is required', label);
        else if (/^https?:\/\//.test(element.src)) add('error', 'remote image URLs are not allowed; download the verified asset into assets/', label);
        else if (!fs.existsSync(path.resolve(baseDir, element.src))) add('error', `image asset not found: ${element.src}`, label);
        if (element.sizing !== undefined && !ALLOWED_SIZING.has(element.sizing)) add('error', 'image sizing must be cover or contain', label);
        if (!isTransparency(element.transparency)) add('error', 'image transparency must be between 0 and 100', label);
      }
      if (element.type === 'shape') {
        if (!element.fill && !element.line && !element.gradient) add('error', 'shape requires fill, line, or gradient; do not inherit a default primary color', label);
        if (element.fill && !HEX.test(resolveColor(element.fill, colors) ?? '')) add('error', 'shape fill must resolve to #RRGGBB', label);
        if (element.line && !HEX.test(resolveColor(element.line, colors) ?? '')) add('error', 'shape line must resolve to #RRGGBB', label);
        if (!isTransparency(element.fillTransparency) || !isTransparency(element.lineTransparency)) add('error', 'shape transparency must be between 0 and 100', label);
        if (element.gradient) {
          if (element.shape && element.shape !== 'rect') add('error', 'gradient shapes must use rect', label);
          if (!element.gradient || typeof element.gradient !== 'object') add('error', 'gradient must be an object', label);
          else {
            if (!HEX.test(resolveColor(element.gradient.from, colors) ?? '') || !HEX.test(resolveColor(element.gradient.to, colors) ?? '')) add('error', 'gradient from and to must resolve to #RRGGBB', label);
            if (element.gradient.direction !== undefined && !ALLOWED_GRADIENT_DIRECTIONS.has(element.gradient.direction)) add('error', 'gradient direction must be horizontal or vertical', label);
            if (element.gradient.steps !== undefined && (!Number.isInteger(element.gradient.steps) || element.gradient.steps < 2 || element.gradient.steps > 32)) add('error', 'gradient steps must be an integer between 2 and 32', label);
          }
        }
      }
      if (element.type === 'text') {
        if (typeof element.text !== 'string') add('error', 'text content must be a string', label);
        const style = element.style?.startsWith('$') ? styles[element.style.slice(1)] ?? {} : {};
        const fontSize = element.fontSize ?? style.fontSize;
        if (!Number.isFinite(fontSize)) add('error', 'text requires fontSize or a valid text style', label);
        else {
          const minimum = element.role === 'caption' ? 12 : 18;
          if (fontSize < minimum) add('error', `font size ${fontSize}pt is below the ${minimum}pt minimum`, label);
          const metrics = textMetrics(element.text, fontSize, width, element.lineHeight ?? style.lineHeight, element.wrap);
          const fontPixels = fontSize * (96 / 72);
          const linePixels = fontPixels * Math.max(element.lineHeight ?? style.lineHeight ?? 1.3, 1.3);
          pageTextArea += Math.min(metrics.width, width) * metrics.height;
          if (element.wrap === false && metrics.width > width) {
            add('error', `single-line text overflows its width by ${Math.ceil(metrics.width - width)}px; widen the element or shorten the text`, label);
          }
          if (metrics.height > height) {
            const linesFit = Math.max(1, Math.floor(height / linePixels));
            const linesShort = Math.max(1, metrics.lines - linesFit);
            add('error', `text overflows its height by ${Math.ceil(metrics.height - height)}px (about ${linesShort} line(s)); increase height, shorten the text, or lower the font size`, label);
          }
          if (height > metrics.height * 3 && !element.allowUnderfill) add('warning', 'text box is substantially underfilled; tighten bounds or improve composition', label);
        }
        const color = resolveColor(element.color ?? style.color ?? '$text', colors);
        if (!HEX.test(color ?? '')) add('error', 'text color must resolve to #RRGGBB', label);
        textElements.push(element);
      }
      if (element.type === 'table') {
        if (!Array.isArray(element.rows) || element.rows.length === 0 || element.rows.some(row => !Array.isArray(row) || row.length === 0)) add('error', 'table rows must be a non-empty matrix', label);
        else if (element.rows.some(row => row.some(cell => typeof cell !== 'string' && typeof cell !== 'number'))) add('error', 'table cells must be strings or numbers', label);
        const tableFontSize = element.fontSize ?? 18;
        if (!Number.isFinite(tableFontSize) || tableFontSize < 12) add('error', 'table font size must be at least 12pt', label);
        for (const field of ['fill', 'borderColor', 'headerFill', 'headerColor']) {
          if (element[field] !== undefined && !HEX.test(resolveColor(element[field], colors) ?? '')) add('error', `table ${field} must resolve to #RRGGBB`, label);
        }
      }
      if (element.type === 'chart') {
        if (!ALLOWED_CHART_TYPES.has(element.chartType)) add('error', `unsupported chart type ${element.chartType}`, label);
        if (!Array.isArray(element.data) || element.data.length === 0) add('error', 'chart data must contain at least one series', label);
        else for (const series of element.data) {
          if (!series || typeof series.name !== 'string' || !Array.isArray(series.labels) || !Array.isArray(series.values)) add('error', 'chart series requires name, labels, and values', label);
          else if (series.labels.length === 0 || series.labels.length !== series.values.length || series.values.some(value => !Number.isFinite(value))) add('error', 'chart labels and numeric values must have matching non-zero lengths', label);
        }
        if (Array.isArray(element.data) && element.data.length > 1 && (!Array.isArray(element.colors) || element.colors.length < element.data.length)) add('error', 'multi-series chart requires one explicit color per series', label);
        if (element.colors !== undefined && (!Array.isArray(element.colors) || element.colors.some(value => !HEX.test(resolveColor(value, colors) ?? '')))) add('error', 'chart colors must resolve to #RRGGBB', label);
      }
    }
    for (let i = 0; i < textElements.length; i += 1) for (let j = i + 1; j < textElements.length; j += 1) {
      if (!textElements[i].allowOverlap && !textElements[j].allowOverlap && intersects(textElements[i].bounds, textElements[j].bounds)) add('error', `text overlaps ${textElements[j].id}`, `${pageLabel}:${textElements[i].id}`);
    }
    // Structural feasibility: if the rendered text area alone exceeds the
    // usable canvas area, no bounds adjustment can make the page fit. Report
    // it as a content-budget error so the model reduces content or splits the
    // page instead of re-tweaking bounds.
    const safeArea = Math.max(canvas.width - 2 * safeMargin, 1) * Math.max(canvas.height - 2 * safeMargin, 1);
    if (pageTextArea > safeArea) {
      const overBy = Math.ceil((pageTextArea / safeArea - 1) * 100);
      add('error', `page text content exceeds the available canvas budget by ${overBy}%; bounds adjustments cannot fix this — reduce the text, split the page, or use a denser layout`, pageLabel);
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
