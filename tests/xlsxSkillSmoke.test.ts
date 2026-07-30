import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test } from 'vitest';

const root = path.resolve(__dirname, '..');
const skillRoot = path.join(root, 'SKILLs', 'xlsx');

test('XLSX skill packs its template and runs the mandatory formula validator', () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'zhiyuan-xlsx-skill-'));
  const output = path.join(workspace, 'minimal.xlsx');
  try {
    execFileSync(
      'python3',
      [
        path.join(skillRoot, 'scripts', 'xlsx_pack.py'),
        path.join(skillRoot, 'templates', 'minimal_xlsx'),
        output,
      ],
      { stdio: 'pipe' },
    );
    execFileSync(
      'python3',
      [path.join(skillRoot, 'scripts', 'formula_check.py'), output, '--json'],
      { stdio: 'pipe' },
    );
    assert.equal(existsSync(output), true, 'XLSX packer did not write its output');
    assert.ok(statSync(output).size > 0, 'XLSX output is empty');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('XLSX skill includes a controlled renderer for inspected shortcut previews', () => {
  const renderer = path.join(skillRoot, 'scripts', 'xlsx_render_preview.sh');
  assert.equal(existsSync(renderer), true, 'XLSX preview renderer is missing');
  const usage = spawnSync('bash', [renderer], { encoding: 'utf8', stdio: 'pipe' });
  // The renderer should require explicit input/output instead of silently
  // accepting a claimed preview path.
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage:/);
});
