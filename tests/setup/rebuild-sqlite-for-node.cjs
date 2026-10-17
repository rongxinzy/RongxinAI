const { spawnSync } = require('node:child_process');

module.exports = async function globalSetup() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npmCommand, ['rebuild', 'better-sqlite3', '--build-from-source'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error('[vitest] better-sqlite3 rebuild for Node failed.');
  }
};
