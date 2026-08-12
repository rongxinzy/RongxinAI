import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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

test('XLSX skill delegates inspected shortcut previews to the bundled application renderer', () => {
  const instructions = readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(instructions, /"action": "render_preview"/);
  assert.match(instructions, /does not require\s+LibreOffice, Poppler, Python/s);
  assert.doesNotMatch(instructions, /xlsx_render_preview\.sh/);
});
