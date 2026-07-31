#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const [deckPathArg, outputPathArg] = process.argv.slice(2);
if (!deckPathArg || !outputPathArg) throw new Error('Usage: compile-deck.mjs <deck.json> <output.pptx>');
const deckPath = path.resolve(deckPathArg);
const outputPath = path.resolve(outputPathArg);
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validation = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', 'validate-deck.mjs'), deckPath, '--strict'], { stdio: 'inherit' });
if (validation.status !== 0) throw new Error('DeckSpec validation must pass before compilation');
let pptxgen;
try { pptxgen = require(require.resolve('pptxgenjs', { paths: [skillRoot] })); }
catch { throw new Error(`pptxgenjs is missing. Run: npm install --prefix "${skillRoot}"`); }
let imageSize;
try { ({ imageSize } = require(require.resolve('image-size', { paths: [skillRoot] }))); }
catch { throw new Error(`image-size is missing. Run: npm install --prefix "${skillRoot}"`); }
const deck = JSON.parse(fs.readFileSync(deckPath, 'utf8'));
const baseDir = path.dirname(deckPath);
const { width, height } = deck.canvas;
const pres = new pptxgen();
pres.defineLayout({ name: 'DECKSPEC', width: width / 96, height: height / 96 });
pres.layout = 'DECKSPEC';
pres.author = 'ZhiYuan Agent Presentation Studio';
pres.subject = deck.title ?? 'Presentation';
const colors = deck.theme.colors;
const styles = deck.theme.textStyles ?? {};
const color = value => value?.startsWith('$') ? colors[value.slice(1)] : value;
const inch = value => value / 96;
const transparency = value => Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : undefined;
const hexToRgb = value => {
  const hex = value.replace(/^#/, '');
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
};
const blend = (from, to, amount) => hexToRgb(from).map((channel, index) => Math.round(channel + (hexToRgb(to)[index] - channel) * amount).toString(16).padStart(2, '0')).join('').toUpperCase();
const imageOptions = (imagePath, sizing, x, y, w, h) => {
  if (sizing !== 'cover' && sizing !== 'contain') return { path: imagePath, x, y, w, h };
  const { width, height } = imageSize(imagePath);
  if (!width || !height) throw new Error(`Cannot determine image dimensions: ${imagePath}`);
  return { path: imagePath, x, y, w: width / 96, h: height / 96, sizing: { type: sizing, x, y, w, h } };
};
for (const pageRef of deck.pages) {
  const page = JSON.parse(fs.readFileSync(path.resolve(baseDir, pageRef), 'utf8'));
  const slide = pres.addSlide();
  slide.background = { color: color(page.background ?? '$background') };
  for (const element of page.elements) {
    const [x, y, w, h] = element.bounds.map(inch);
    if (element.type === 'shape' && element.gradient) {
      const { from, to, direction = 'horizontal', steps = 12 } = element.gradient;
      for (let index = 0; index < steps; index += 1) {
        const amount = steps === 1 ? 0 : index / (steps - 1);
        const horizontal = direction === 'horizontal';
        const band = horizontal
          ? { x: x + (w * index) / steps, y, w: w / steps + 0.001, h }
          : { x, y: y + (h * index) / steps, w, h: h / steps + 0.001 };
        slide.addShape(pres.ShapeType.rect, { ...band, fill: { color: blend(color(from), color(to), amount), transparency: transparency(element.fillTransparency) }, line: { color: 'FFFFFF', transparency: 100 } });
      }
    }
    if (element.type === 'shape' && !element.gradient) {
      const fill = element.fill ? { color: color(element.fill), transparency: transparency(element.fillTransparency) } : { color: 'FFFFFF', transparency: 100 };
      const line = element.line ? { color: color(element.line), transparency: transparency(element.lineTransparency), width: element.lineWidth, dashType: element.lineDash } : { color: 'FFFFFF', transparency: 100 };
      slide.addShape(pres.ShapeType[element.shape] ?? pres.ShapeType.rect, { x, y, w, h, fill, line, rotate: element.rotate });
    }
    if (element.type === 'image') slide.addImage({ ...imageOptions(path.resolve(baseDir, element.src), element.sizing, x, y, w, h), transparency: transparency(element.transparency), rotate: element.rotate });
    if (element.type === 'text') {
      const style = element.style?.startsWith('$') ? styles[element.style.slice(1)] ?? {} : {};
      slide.addText(element.text, { x, y, w, h, fontFace: element.fontFace ?? style.fontFace, fontSize: element.fontSize ?? style.fontSize, color: color(element.color ?? style.color ?? '$text'), bold: element.bold ?? style.bold, italic: element.italic ?? style.italic, charSpacing: element.charSpacing ?? style.charSpacing, margin: element.margin ?? 0, fit: 'none', align: element.align ?? 'left', valign: element.valign ?? 'top', paraSpaceAfterPt: 0, rotate: element.rotate });
    }
    if (element.type === 'table') {
      const rows = element.rows.map((row, index) => index === 0 && (element.headerFill || element.headerColor)
        ? row.map(text => ({ text, options: { bold: true, color: color(element.headerColor ?? '$text'), fill: color(element.headerFill ?? '$surface') } }))
        : row);
      slide.addTable(rows, { x, y, w, h, fontFace: element.fontFace ?? 'Microsoft YaHei', fontSize: element.fontSize ?? 18, color: color(element.color ?? '$text'), border: { color: color(element.borderColor ?? '$muted'), pt: element.borderWidth ?? 1 }, fill: color(element.fill ?? '$surface'), margin: 0.05, valign: 'mid' });
    }
    if (element.type === 'chart') {
      const chartColors = element.colors?.map(color) ?? (element.data.length === 1 ? [colors.primary] : []);
      slide.addChart(pres.ChartType[element.chartType], element.data, { x, y, w, h, showLegend: element.showLegend ?? false, showTitle: false, showValue: element.showValue ?? false, chartColors });
    }
  }
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
await pres.writeFile({ fileName: outputPath });
if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) throw new Error('PPTX compilation did not produce a non-empty file');
console.log(`Compiled ${deck.pages.length} pages to ${outputPath}`);
