import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

test.skipIf(process.platform === 'win32')(
  'native preparation rebuilds only incompatible modules and probes every warm restore',
  () => {
    const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'node-native-cache-')));
    const sqlite = 'module.exports=class{prepare(){return{get(){return 1}}}close(){}};';
    try {
      for (const directory of [
        'scripts',
        'bin',
        'node_modules/better-sqlite3',
        'node_modules/node-pty',
      ]) {
        mkdirSync(path.join(root, directory), { recursive: true });
      }
      copyFileSync(
        'scripts/ensure-node-native.cjs',
        path.join(root, 'scripts/ensure-node-native.cjs'),
      );
      for (const name of ['better-sqlite3', 'node-pty']) {
        writeFileSync(
          path.join(root, 'node_modules', name, 'package.json'),
          JSON.stringify({ name, main: 'index.js' }),
        );
      }
      writeFileSync(path.join(root, 'node_modules/node-pty/index.js'), 'exports.spawn=()=>{};');
      writeFileSync(
        path.join(root, 'node_modules/better-sqlite3/index.js'),
        "throw new Error('wrong native ABI');",
      );
      writeFileSync(
        path.join(root, 'bin/bun'),
        `#!/usr/bin/env node
const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(path.join(root, 'builds'))},process.cwd()+String.fromCharCode(10));fs.writeFileSync('index.js',${JSON.stringify(sqlite)});`,
        { mode: 0o755 },
      );
      const run = () =>
        spawnSync(process.execPath, ['scripts/ensure-node-native.cjs'], {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
          },
        });
      const cold = run();
      expect(cold.status, cold.stderr).toBe(0);
      expect(run().status).toBe(0);
      expect(readFileSync(path.join(root, 'builds'), 'utf8').trim().split('\n')).toEqual([
        path.join(root, 'node_modules/better-sqlite3'),
      ]);
      writeFileSync(
        path.join(root, 'node_modules/better-sqlite3/index.js'),
        "throw new Error('corrupted cached addon');",
      );
      writeFileSync(path.join(root, 'bin/bun'), '#!/usr/bin/env node\nprocess.exit(19);', {
        mode: 0o755,
      });
      expect(run().status).not.toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
