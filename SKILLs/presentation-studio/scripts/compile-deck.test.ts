import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { afterEach, expect, test } from 'vitest';

const skillRoot = fileURLToPath(new URL('..', import.meta.url));
const compiler = path.join(skillRoot, 'scripts', 'compile-deck.mjs');
const roots: string[] = [];

const createProject = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'presentation-studio-compile-'));
  roots.push(root);
  fs.cpSync(path.join(skillRoot, 'examples', 'minimal'), root, { recursive: true });
  return root;
};

const compile = (root: string) =>
  spawnSync(
    process.execPath,
    [compiler, path.join(root, 'deck.json'), path.join(root, 'output', 'presentation.pptx')],
    { encoding: 'utf8' },
  );

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('compiles native text, shapes, tables and charts without a validation report', async () => {
  const root = createProject();
  const pagePath = path.join(root, 'pages', '01-cover.json');
  const page = JSON.parse(fs.readFileSync(pagePath, 'utf8')) as {
    elements: Array<Record<string, unknown>>;
  };
  page.elements.push(
    {
      id: 'table',
      type: 'table',
      bounds: [96, 440, 500, 180],
      rows: [['Metric', 'Result'], ['Revenue', '42%']],
      fontSize: 18,
      headerFill: '$primary',
      headerColor: '$background',
    },
    {
      id: 'chart',
      type: 'chart',
      chartType: 'bar',
      bounds: [640, 430, 500, 220],
      data: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [18, 42] }],
      colors: ['$series1'],
    },
  );
  fs.writeFileSync(pagePath, JSON.stringify(page));

  const result = compile(root);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(root, 'output', 'presentation.pptx')));
  const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect(slide).toContain('A decisive action title');
  expect(slide).toContain('<a:tbl>');
  expect(slide).toContain('<c:chart');
  expect(zip.file('ppt/charts/chart1.xml')).not.toBeNull();
  expect(fs.readdirSync(path.join(root, 'output'))).toEqual(['presentation.pptx']);
});

test('exports captions and intentional overlap without imposing layout gates', async () => {
  const root = createProject();
  const pagePath = path.join(root, 'pages', '01-cover.json');
  const page = JSON.parse(fs.readFileSync(pagePath, 'utf8')) as {
    elements: Array<Record<string, unknown>>;
  };
  page.elements.push({
    id: 'caption',
    type: 'text',
    bounds: [96, 244, 860, 40],
    fontSize: 13,
    color: '$text',
    text: 'Source note',
  });
  fs.writeFileSync(pagePath, JSON.stringify(page));

  const result = compile(root);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(root, 'output', 'presentation.pptx')));
  const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect(slide).toContain('Source note');
  expect(slide).toContain('sz="1300"');
});
