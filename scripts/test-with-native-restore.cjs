const { spawnSync } = require('node:child_process');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
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

const nodeBuildStatus = run(npmCommand, ['rebuild', 'better-sqlite3']);
const testStatus =
  nodeBuildStatus === 0
    ? run(npmCommand, ['exec', '--', 'vitest', 'run', ...process.argv.slice(2)])
    : nodeBuildStatus;

// CI jobs end after tests, so restoring Electron's ABI only adds a network dependency.
if (process.env.CI === 'true') {
  process.exit(testStatus);
}

// Tests use Node's ABI; restore Electron's ABI before returning to the caller.
const electronRestoreStatus = run(npmCommand, ['run', 'rebuild:electron-native']);

process.exit(testStatus !== 0 ? testStatus : electronRestoreStatus);
