'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Host npm prebuilds must be removed or better-sqlite3 gyp skips the Electron rebuild. */
const LINUX_BETTER_SQLITE3_PREBUILD_NAMES = [
  'linux-x64.node',
  'linux-arm64.node',
  'linuxmusl-x64.node',
  'linuxmusl-arm64.node',
];

function stripLinuxBetterSqlite3Prebuilds(projectRoot) {
  const prebuildsDir = path.join(projectRoot, 'node_modules/better-sqlite3/prebuilds');
  if (!fs.existsSync(prebuildsDir)) {
    return [];
  }
  const removed = [];
  for (const name of LINUX_BETTER_SQLITE3_PREBUILD_NAMES) {
    const filePath = path.join(prebuildsDir, name);
    if (!fs.existsSync(filePath)) continue;
    fs.rmSync(filePath);
    removed.push(filePath);
  }
  return removed;
}

function main() {
  const projectRoot = path.join(__dirname, '../..');
  const removed = stripLinuxBetterSqlite3Prebuilds(projectRoot);
  console.log(
    `[prepare-linux-electron-native-rebuild] Removed ${removed.length} Linux better-sqlite3 prebuild(s) so electron-rebuild compiles for Electron.`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  LINUX_BETTER_SQLITE3_PREBUILD_NAMES,
  stripLinuxBetterSqlite3Prebuilds,
};
