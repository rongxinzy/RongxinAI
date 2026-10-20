const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const modules = ['better-sqlite3', 'node-pty'];
const local = process.env.CI !== 'true';
const backup = local ? fs.mkdtempSync(path.join(os.tmpdir(), 'unit-native-original-')) : null;
const fingerprint = crypto.createHash('sha256');
for (const file of [
  'bun.lock',
  'scripts/ensure-node-native.cjs',
  ...fs
    .readdirSync(path.join(root, 'patches'), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)))
    .sort(),
]) {
  const source = path.join(root, file);
  if (fs.existsSync(source)) fingerprint.update(file).update(fs.readFileSync(source));
}
const cache = path.join(
  root,
  '.cache',
  'unit-native',
  [process.platform, process.arch, process.versions.node, fingerprint.digest('hex')].join('-'),
);
const output = name => path.join(root, 'node_modules', name, 'build/Release');
let status = 1;
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error('[UnitTests] command failed:', result.error);
  return result.status ?? 1;
}
try {
  if (local)
    for (const name of modules) {
      if (fs.existsSync(output(name)))
        fs.cpSync(output(name), path.join(backup, name), { recursive: true });
      if (fs.existsSync(path.join(cache, name)))
        fs.cpSync(path.join(cache, name), output(name), { recursive: true });
    }
  status = run(['scripts/ensure-node-native.cjs']);
  if (status === 0) {
    if (local)
      for (const name of modules) {
        if (fs.existsSync(output(name)))
          fs.cpSync(output(name), path.join(cache, name), { recursive: true });
      }
    status = run([
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'vitest.unit.config.ts',
      ...process.argv.slice(2),
    ]);
  }
} finally {
  if (local) {
    for (const name of modules) {
      if (fs.existsSync(path.join(backup, name)))
        fs.cpSync(path.join(backup, name), output(name), { recursive: true });
    }
    fs.rmSync(backup, { recursive: true, force: true });
  }
}
process.exit(status);
