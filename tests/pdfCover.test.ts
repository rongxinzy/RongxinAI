import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test } from 'vitest';

const scriptsDir = path.resolve(__dirname, '..', 'SKILLs', 'pdf', 'scripts');
const coverPy = path.join(scriptsDir, 'cover.py');

const PATTERN_KEYS = [
  'fullbleed',
  'split',
  'typographic',
  'atmospheric',
  'minimal',
  'stripe',
  'diagonal',
  'frame',
  'editorial',
  'magazine',
  'darkroom',
  'terminal',
  'poster',
] as const;

// Marker strings unique to each pattern's rendered HTML.
const PATTERN_MARKERS: Record<string, string> = {
  fullbleed: 'footer-author',
  split: 'left-panel',
  typographic: 'first-word',
  atmospheric: 'glow2',
  minimal: 'eyebrow',
  stripe: 'band-top',
  diagonal: 'content-dark',
  frame: 'frame-top-accent',
  editorial: 'ghost',
  magazine: 'org-name',
  darkroom: 'org-rule',
  terminal: 'bracket-block',
  poster: 'sidebar',
};

function baseTokens(pattern: string) {
  return {
    cover_pattern: pattern,
    cover_bg: '#1A1A2E',
    page_bg: '#FAFAF8',
    accent: '#E07A5F',
    text_light: '#FFFFFF',
    dark: '#111111',
    muted: '#999999',
    font_display: 'Playfair Display',
    font_body: 'Inter',
    gfonts_import: 'https://fonts.googleapis.com/css2?family=Inter',
    title: 'Quarterly Engineering Review',
    subtitle: 'A deep dive into platform reliability',
    author: 'Ada Lovelace',
    date: '2026-10-01',
    doc_type: 'report',
    abstract: 'Numbers went up and also sometimes down.',
    cover_image: 'hero.png',
  };
}

function runCover(args: string[]) {
  return spawnSync('python3', [coverPy, ...args], { encoding: 'utf8' });
}

test('cover.py renders every pattern through the CLI', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pdf-cover-'));
  for (const pattern of PATTERN_KEYS) {
    const tokensPath = path.join(dir, `${pattern}.tokens.json`);
    const outPath = path.join(dir, `${pattern}.html`);
    writeFileSync(tokensPath, JSON.stringify(baseTokens(pattern)));

    const result = runCover(['--tokens', tokensPath, '--out', outPath]);
    assert.equal(result.status, 0, `pattern ${pattern} stderr: ${result.stderr}`);

    const summary = JSON.parse(result.stdout.trim());
    assert.equal(summary.status, 'ok');
    assert.equal(summary.pattern, pattern);
    assert.equal(summary.out, outPath);

    const html = readFileSync(outPath, 'utf8');
    // Shared base CSS + fonts import are present in every pattern.
    assert.match(html, /@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Inter'\);/);
    assert.match(html, /width: 794px; height: 1123px;/);
    // Title first word + author appear in every pattern (typographic splits
    // the title across two elements, so only the first word is contiguous).
    assert.ok(html.includes('Quarterly'));
    assert.ok(html.includes('Ada Lovelace'));
    // Pattern-specific marker pins dispatch to the right renderer.
    assert.ok(
      html.includes(PATTERN_MARKERS[pattern]),
      `pattern ${pattern} is missing marker ${PATTERN_MARKERS[pattern]}`,
    );
  }
});

test('cover.py falls back to fullbleed for unknown patterns', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pdf-cover-'));
  const tokensPath = path.join(dir, 'tokens.json');
  writeFileSync(
    tokensPath,
    JSON.stringify({ ...baseTokens('fullbleed'), cover_pattern: 'does-not-exist' }),
  );
  const unknownOut = path.join(dir, 'unknown.html');
  const result = runCover(['--tokens', tokensPath, '--out', unknownOut]);
  assert.equal(result.status, 0);

  const fullbleedOut = path.join(dir, 'fullbleed.html');
  writeFileSync(tokensPath, JSON.stringify(baseTokens('fullbleed')));
  const reference = runCover(['--tokens', tokensPath, '--out', fullbleedOut]);
  assert.equal(reference.status, 0);

  assert.equal(readFileSync(unknownOut, 'utf8'), readFileSync(fullbleedOut, 'utf8'));
});

test('cover.py applies the --subtitle CLI override', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pdf-cover-'));
  const tokensPath = path.join(dir, 'tokens.json');
  writeFileSync(tokensPath, JSON.stringify(baseTokens('fullbleed')));
  const outPath = path.join(dir, 'cover.html');
  const result = runCover([
    '--tokens',
    tokensPath,
    '--out',
    outPath,
    '--subtitle',
    'CLI override subtitle',
  ]);
  assert.equal(result.status, 0);
  const html = readFileSync(outPath, 'utf8');
  assert.ok(html.includes('CLI override subtitle'));
  assert.ok(!html.includes('A deep dive into platform reliability'));
});

test('cover.py exits 1 with error JSON for bad tokens input', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pdf-cover-'));
  const missing = runCover([
    '--tokens',
    path.join(dir, 'missing.json'),
    '--out',
    path.join(dir, 'a.html'),
  ]);
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stderr.trim()).status, 'error');
  assert.match(missing.stderr, /tokens file not found/);

  const badPath = path.join(dir, 'bad.json');
  writeFileSync(badPath, '{not json');
  const invalid = runCover(['--tokens', badPath, '--out', path.join(dir, 'b.html')]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /invalid JSON/);
});

test('cover.py re-exports the split cover_lib modules', () => {
  const probe = spawnSync(
    'python3',
    [
      '-c',
      [
        'import cover',
        'expected = ' + JSON.stringify([...PATTERN_KEYS]),
        'assert sorted(cover.PATTERNS) == sorted(expected), sorted(cover.PATTERNS)',
        'assert set(cover.PATTERNS) == set(expected)',
        'for fn in cover.PATTERNS.values(): assert callable(fn)',
        'for name in ("render", "main", "_base_css", "_dot_grid", "_cross_hatch", "_gfonts_import"):',
        '    assert callable(getattr(cover, name)), name',
        'assert cover.render({"cover_pattern": "terminal", "title": "T", "accent": "#0f0",',
        '    "cover_bg": "#000", "page_bg": "#111", "text_light": "#eee", "muted": "#888",',
        '    "dark": "#000", "font_display": "F", "font_body": "B"}).find("bracket-block") > 0',
        'print("ok")',
      ].join('\n'),
    ],
    { cwd: scriptsDir, encoding: 'utf8' },
  );
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), 'ok');
});
