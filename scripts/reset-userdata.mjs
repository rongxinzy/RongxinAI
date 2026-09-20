/**
 * Author: lixiang
 * Date: 2026/09/17
 * Description: 清除 XiaoruanAgent 用户数据，下次启动等同全新安装（不动 node_modules/dist/release）
 *
 * Usage:
 *   node scripts/reset-userdata.mjs
 *   npm run reset:userdata
 *   npm run electron:dev:fresh
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_DATA_DIR_NAME = 'XiaoruanAgent';

function roamingAppDataRoots() {
  switch (process.platform) {
    case 'win32':
      return [process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')].filter(Boolean);
    case 'darwin':
      return [path.join(os.homedir(), 'Library', 'Application Support')];
    default:
      return [process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')];
  }
}

function localAppDataRoots() {
  if (process.platform !== 'win32') return [];
  return [process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')].filter(Boolean);
}

function removePath(target) {
  if (!fs.existsSync(target)) {
    console.log(`[reset:userdata] skip (missing): ${target}`);
    return false;
  }
  const lockfile = path.join(target, 'lockfile');
  if (fs.existsSync(lockfile)) {
    console.warn(
      `[reset:userdata] warning: lockfile present — close the running app first if delete fails: ${lockfile}`,
    );
  }
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`[reset:userdata] removed: ${target}`);
  return true;
}

const targets = [
  ...roamingAppDataRoots().map((root) => path.join(root, APP_DATA_DIR_NAME)),
  ...localAppDataRoots().map((root) => path.join(root, APP_DATA_DIR_NAME)),
];

let removed = 0;
for (const target of targets) {
  if (removePath(target)) removed += 1;
}

console.log(
  removed > 0
    ? `[reset:userdata] done — next launch will start from a clean state (${removed} path(s)).`
    : '[reset:userdata] done — nothing to remove (already clean).',
);
