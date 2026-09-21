/**
 * Patch the development electron.exe embedded icon/version strings so the
 * Windows taskbar shows the 晓软智能体 logo instead of the default Electron atom.
 *
 * BrowserWindow.setIcon alone is not enough while running unpackaged electron.exe;
 * Windows still prefers the executable's resource icon for the taskbar button.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const iconPath = path.join(projectRoot, 'build', 'icons', 'win', 'icon.ico');
const electronExePath = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const cacheDirectory = path.join(projectRoot, '.cache', 'rcedit');
const rceditPath = path.join(cacheDirectory, 'rcedit-x64.exe');
const stampPath = path.join(cacheDirectory, 'electron-icon.stamp');
const RCEDIT_DOWNLOAD_URL =
  'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe';
const APP_BUILDER_PATH = path.join(
  projectRoot,
  'node_modules',
  'app-builder-bin',
  'win',
  'x64',
  'app-builder.exe',
);
const PRODUCT_NAME = '晓软智能体';

function fileSha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function ensureRcedit() {
  if (fs.existsSync(rceditPath) && fs.statSync(rceditPath).size > 0) {
    return;
  }
  fs.mkdirSync(cacheDirectory, { recursive: true });
  if (!fs.existsSync(APP_BUILDER_PATH)) {
    throw new Error(`Missing app-builder binary at ${APP_BUILDER_PATH}`);
  }
  const result = spawnSync(
    APP_BUILDER_PATH,
    ['download', `--url=${RCEDIT_DOWNLOAD_URL}`, `--output=${rceditPath}`],
    { stdio: 'inherit' },
  );
  if (result.status !== 0 || !fs.existsSync(rceditPath)) {
    throw new Error('Failed to download rcedit-x64.exe');
  }
}

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(stampPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeStamp(payload) {
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.writeFileSync(stampPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function patchElectronIcon() {
  if (process.platform !== 'win32') {
    return;
  }
  if (!fs.existsSync(electronExePath)) {
    console.warn('[patch-windows-electron-icon] electron.exe is missing; skip.');
    return;
  }
  if (!fs.existsSync(iconPath)) {
    console.warn('[patch-windows-electron-icon] app icon is missing; skip:', iconPath);
    return;
  }

  const iconHash = fileSha256(iconPath);
  const electronStat = fs.statSync(electronExePath);
  const stamp = readStamp();
  if (
    stamp &&
    stamp.iconHash === iconHash &&
    stamp.electronSize === electronStat.size &&
    stamp.electronMtimeMs === electronStat.mtimeMs
  ) {
    console.log('[patch-windows-electron-icon] Development electron.exe icon already patched.');
    return;
  }

  ensureRcedit();
  console.log('[patch-windows-electron-icon] Patching development electron.exe icon...');
  const result = spawnSync(
    rceditPath,
    [
      electronExePath,
      '--set-icon',
      iconPath,
      '--set-version-string',
      'FileDescription',
      PRODUCT_NAME,
      '--set-version-string',
      'ProductName',
      PRODUCT_NAME,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(
      `rcedit failed to patch electron.exe${detail ? `: ${detail}` : ''}. Close running Electron processes and retry.`,
    );
  }

  const patchedStat = fs.statSync(electronExePath);
  writeStamp({
    iconHash,
    electronSize: patchedStat.size,
    electronMtimeMs: patchedStat.mtimeMs,
    patchedAt: new Date().toISOString(),
  });
  console.log('[patch-windows-electron-icon] Development electron.exe icon patched.');
}

try {
  patchElectronIcon();
} catch (error) {
  console.warn(
    '[patch-windows-electron-icon]',
    error instanceof Error ? error.message : String(error),
  );
}
