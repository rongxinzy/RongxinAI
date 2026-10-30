import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

const root = path.resolve(__dirname, '..');
const skillRoot = path.join(root, 'SKILLs', 'pdf');

test('PDF skill exposes optional rendering through the managed uv runtime', () => {
  const preview = path.join(skillRoot, 'scripts', 'pdf_preview.py');
  assert.equal(existsSync(preview), true, 'PDF preview renderer is missing');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  execFileSync(python, [preview, '--help'], { stdio: 'pipe' });

  const pipeline = readFileSync(path.join(skillRoot, 'scripts', 'make.sh'), 'utf8');
  assert.match(pipeline, /run --quiet --no-project --python/);
  assert.doesNotMatch(pipeline, /--break-system-packages/);

  for (const entry of readdirSync(path.join(skillRoot, 'scripts'))) {
    if (!entry.endsWith('.py')) continue;
    const source = readFileSync(path.join(skillRoot, 'scripts', entry), 'utf8');
    assert.doesNotMatch(source, /--break-system-packages/);
  }
});
