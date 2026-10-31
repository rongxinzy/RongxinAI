import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test } from 'vitest';
import * as XLSX from 'xlsx';

const root = path.resolve(__dirname, '..');
const skillRoot = path.join(root, 'SKILLs', 'xlsx');
const python = process.platform === 'win32' ? 'python' : 'python3';

test('XLSX skill packs its template into a readable workbook', () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'zhiyuan-xlsx-skill-'));
  const output = path.join(workspace, 'minimal.xlsx');
  try {
    execFileSync(
      python,
      [
        path.join(skillRoot, 'scripts', 'xlsx_pack.py'),
        path.join(skillRoot, 'templates', 'minimal_xlsx'),
        output,
      ],
      { stdio: 'pipe', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
    );
    const workbook = XLSX.read(readFileSync(output), { type: 'buffer' });
    assert.deepEqual(workbook.SheetNames, ['Sheet1']);
    assert.ok(workbook.Sheets.Sheet1, 'XLSX output contains no readable worksheet');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
