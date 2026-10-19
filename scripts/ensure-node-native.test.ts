import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

test('fresh installs rebuild only missing native modules and re-probe the result', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'native-probe-'));
  const put = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  try {
    copyFileSync(path.join(__dirname, 'ensure-node-native.cjs'), path.join(root, 'probe.cjs'));
    for (const name of ['better-sqlite3', 'node-pty']) {
      put(`node_modules/${name}/package.json`, JSON.stringify({ name, main: 'index.js' }));
    }
    put(
      'node_modules/better-sqlite3/index.js',
      'module.exports=class{prepare(){return {get(){}}}close(){}}',
    );
    put('node_modules/node-pty/index.js', "throw new Error('pty.node is missing')");
    put(
      'node_modules/node-gyp/bin/node-gyp.js',
      `
      const fs=require('node:fs');
      fs.appendFileSync('../../rebuilds', require(process.cwd()+'/package.json').name);
      if(!process.env.FAIL_NATIVE_REPAIR) fs.writeFileSync('index.js', 'exports.spawn=()=>{}');
    `,
    );
    const run = (failRepair = '') =>
      spawnSync(process.execPath, ['probe.cjs'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, FAIL_NATIVE_REPAIR: failRepair },
      });
    expect(run().status).toBe(0);
    expect(readFileSync(path.join(root, 'rebuilds'), 'utf8')).toBe('node-pty');
    expect(run().status).toBe(0);
    expect(readFileSync(path.join(root, 'rebuilds'), 'utf8')).toBe('node-pty');
    put('node_modules/node-pty/index.js', "throw new Error('pty.node is missing')");
    const failed = run('1');
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('node-pty failed the Node ABI load probe');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
