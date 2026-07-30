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
    if (element.type === 'shape') slide.addShape(pres.ShapeType[element.shape] ?? pres.ShapeType.rect, { x, y, w, h, fill: { color: color(element.fill ?? '$primary') }, line: { color: color(element.line ?? element.fill ?? '$primary'), transparency: element.line ? 0 : 100 } });
    if (element.type === 'image') slide.addImage(imageOptions(path.resolve(baseDir, element.src), element.sizing, x, y, w, h));
    if (element.type === 'text') {
      const style = element.style?.startsWith('$') ? styles[element.style.slice(1)] ?? {} : {};
      slide.addText(element.text, { x, y, w, h, fontFace: element.fontFace ?? style.fontFace, fontSize: element.fontSize ?? style.fontSize, color: color(element.color ?? style.color ?? '$text'), bold: element.bold ?? style.bold, margin: 0, fit: 'none', align: element.align ?? 'left', valign: element.valign ?? 'top', paraSpaceAfterPt: 0 });
    }
    if (element.type === 'table') {
      slide.addTable(element.rows, { x, y, w, h, fontFace: element.fontFace ?? 'Microsoft YaHei', fontSize: element.fontSize ?? 18, color: color(element.color ?? '$text'), border: { color: color(element.borderColor ?? '$primary'), pt: 1 }, fill: color(element.fill ?? '$background'), margin: 0.05, valign: 'mid' });
    }
    if (element.type === 'chart') {
      slide.addChart(pres.ChartType[element.chartType], element.data, { x, y, w, h, showLegend: element.showLegend ?? false, showTitle: false, chartColors: element.colors?.map(color) ?? [colors.primary] });
    }
  }
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
await pres.writeFile({ fileName: outputPath });
if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) throw new Error('PPTX compilation did not produce a non-empty file');
console.log(`Compiled ${deck.pages.length} pages to ${outputPath}`);
