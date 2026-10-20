const { spawnSync } = require('node:child_process');

const bunCommand = process.platform === 'win32' ? 'bun.exe' : 'bun';
const spawnOptions = {
  shell: process.platform === 'win32',
  stdio: 'inherit',
};

function run(command, args) {
  const result = spawnSync(command, args, spawnOptions);
  if (result.error) {
    console.error('[TestNativeRestore] command failed:', result.error);
    return 1;
  }
  return result.status ?? 1;
}

const nodeBuildStatus = run(process.execPath, ['scripts/ensure-node-native.cjs']);
const testStatus =
  nodeBuildStatus === 0
    ? run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)])
    : nodeBuildStatus;

// CI jobs end after tests, so restoring Electron's ABI only adds a network dependency.
if (process.env.CI === 'true') {
  process.exit(testStatus);
}

// Tests use Node's ABI; restore Electron's ABI before returning to the caller.
const electronRestoreStatus = run(bunCommand, ['run', 'rebuild:electron-native']);

process.exit(testStatus !== 0 ? testStatus : electronRestoreStatus);
