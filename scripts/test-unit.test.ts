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
      mkdirSync(path.join(root, 'patches'));
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

test('local unit runs restore the original Electron addon and reuse the Node ABI without another rebuild', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'unit-native-preservation-'));
  try {
    for (const directory of [
      'scripts',
      'patches',
      'node_modules/vitest',
      'node_modules/better-sqlite3/build/Release',
    ]) {
      mkdirSync(path.join(root, directory), { recursive: true });
    }
    copyFileSync('scripts/test-unit.cjs', path.join(root, 'scripts/test-unit.cjs'));
    const binding = 'node_modules/better-sqlite3/build/Release/addon.node';
    writeFileSync(path.join(root, binding), 'Electron ABI');
    writeFileSync(
      path.join(root, 'scripts/ensure-node-native.cjs'),
      `const fs=require('node:fs');if(fs.readFileSync(${JSON.stringify(binding)},'utf8')!=='Node ABI'){fs.appendFileSync('rebuilds','1');fs.writeFileSync(${JSON.stringify(binding)},'Node ABI');}`,
    );
    writeFileSync(
      path.join(root, 'node_modules/vitest/vitest.mjs'),
      `import fs from 'node:fs';if(fs.readFileSync(${JSON.stringify(binding)},'utf8')!=='Node ABI')process.exit(21);`,
    );
    const run = () =>
      spawnSync(process.execPath, ['scripts/test-unit.cjs'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, CI: 'false' },
      });
    expect(run().status).toBe(0);
    expect(readFileSync(path.join(root, binding), 'utf8')).toBe('Electron ABI');
    expect(run().status).toBe(0);
    expect(readFileSync(path.join(root, binding), 'utf8')).toBe('Electron ABI');
    expect(readFileSync(path.join(root, 'rebuilds'), 'utf8')).toBe('1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
