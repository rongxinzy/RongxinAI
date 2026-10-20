import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

test.each([0, 17])(
  'unit runner forwards shard arguments and preserves test exit %s without Electron rebuild',
  exitCode => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'unit-runner-'));
    try {
      mkdirSync(path.join(root, 'scripts'));
      mkdirSync(path.join(root, 'node_modules/vitest'), { recursive: true });
      copyFileSync('scripts/test-unit.cjs', path.join(root, 'scripts/test-unit.cjs'));
      writeFileSync(path.join(root, 'scripts/ensure-node-native.cjs'), 'process.exit(0);');
      writeFileSync(
        path.join(root, 'node_modules/vitest/vitest.mjs'),
        `import fs from 'node:fs';fs.writeFileSync('arguments.json',JSON.stringify(process.argv.slice(2)));process.exit(${exitCode});`,
      );
      const result = spawnSync(
        process.execPath,
        [path.join(root, 'scripts/test-unit.cjs'), '--shard=2/2'],
        { encoding: 'utf8' },
      );
      expect(result.status).toBe(exitCode);
      expect(JSON.parse(readFileSync(path.join(root, 'arguments.json'), 'utf8'))).toEqual([
        'run',
        '--config',
        'vitest.unit.config.ts',
        '--shard=2/2',
      ]);
      expect(result.stderr).not.toMatch(/electron|rebuild/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
