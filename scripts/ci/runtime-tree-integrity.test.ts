import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

test('restored runtime bytes must match the complete sealed tree', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cuda-cache-integrity-'));
  const run = (mode: string) =>
    spawnSync(process.execPath, ['scripts/ci/runtime-tree-integrity.cjs', mode, root], {
      encoding: 'utf8',
    });
  try {
    mkdirSync(path.join(root, 'bin'));
    writeFileSync(path.join(root, 'bin/server.exe'), 'compiled runtime');
    writeFileSync(path.join(root, 'bin/cuda.dll'), 'pinned library');
    expect(run('seal').status).toBe(0);
    expect(run('verify').status).toBe(0);
    writeFileSync(path.join(root, 'bin/cuda.dll'), 'altered library');
    expect(run('verify').status).not.toBe(0);
    writeFileSync(path.join(root, 'bin/cuda.dll'), 'pinned library');
    writeFileSync(path.join(root, 'bin/extra.dll'), 'unexpected library');
    expect(run('verify').status).not.toBe(0);
    rmSync(path.join(root, 'bin/extra.dll'));
    rmSync(path.join(root, 'bin/server.exe'));
    expect(run('verify').status).not.toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
