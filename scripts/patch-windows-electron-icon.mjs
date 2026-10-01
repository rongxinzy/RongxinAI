/**
 * 强制把知远 logo（build/icons/win/icon.ico）写入开发态 electron.exe。
 * Windows 任务栏看的是 exe 内嵌图标，只调 BrowserWindow.setIcon 不够。
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
const PRODUCT_NAME = '知远';
const forcePatch =
  process.argv.includes('--force') || process.env.FORCE_PATCH_ELECTRON_ICON === '1';

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

function writeStamp(payload) {
  fs.mkdirSync(cacheDirectory, { recursive: true });
  fs.writeFileSync(stampPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function patchElectronIcon() {
  if (process.platform !== 'win32') {
    return;
  }
  if (!fs.existsSync(electronExePath)) {
    throw new Error(`electron.exe is missing: ${electronExePath}`);
  }
  if (!fs.existsSync(iconPath)) {
    throw new Error(`知远 logo 不存在: ${iconPath}`);
  }

  const iconHash = fileSha256(iconPath);
  const electronStat = fs.statSync(electronExePath);

  // 默认每次强制写入；只有明确带 --skip-if-fresh 才跳过。
  const skipIfFresh = process.argv.includes('--skip-if-fresh') && !forcePatch;
  if (skipIfFresh) {
    try {
      const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'));
      if (
        stamp.iconHash === iconHash &&
        stamp.productName === PRODUCT_NAME &&
        stamp.electronSize === electronStat.size &&
        stamp.electronMtimeMs === electronStat.mtimeMs
      ) {
        console.log('[patch-windows-electron-icon] already patched, skip.');
        return;
      }
    } catch {
      /* fall through and write */
    }
  }

  ensureRcedit();
  console.log('[patch-windows-electron-icon] 强制写入知远 logo:');
  console.log(`  icon: ${iconPath}`);
  console.log(`  exe:  ${electronExePath}`);

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
      `rcedit 写入失败${detail ? `: ${detail}` : ''}。请先关闭所有 Electron 进程后重试。`,
    );
  }

  const patchedStat = fs.statSync(electronExePath);
  writeStamp({
    iconHash,
    productName: PRODUCT_NAME,
    electronSize: patchedStat.size,
    electronMtimeMs: patchedStat.mtimeMs,
    patchedAt: new Date().toISOString(),
    forced: true,
  });
  console.log('[patch-windows-electron-icon] 已强制写入知远 logo。');
}

try {
  patchElectronIcon();
} catch (error) {
  console.warn(
    '[patch-windows-electron-icon]',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
}
