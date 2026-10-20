const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
for (const args of [
  ['scripts/ensure-node-native.cjs'],
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--config',
    'vitest.unit.config.ts',
    ...process.argv.slice(2),
  ],
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error('[UnitTests] command failed:', result.error);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
