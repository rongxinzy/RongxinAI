import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import concurrently from 'concurrently';

import { resolveDevPort } from './find-dev-port.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const localBinDirectory = path.join(projectRoot, 'node_modules', '.bin');

/**
 * Ensure local package binaries (vite / wait-on / electron) resolve on Windows
 * even when this script is not launched through npm/bun.
 * @param {NodeJS.ProcessEnv} env
 */
function withLocalBinPath(env) {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  const current = env[pathKey] || '';
  if (current.split(path.delimiter).includes(localBinDirectory)) {
    return env;
  }
  return {
    ...env,
    [pathKey]: `${localBinDirectory}${path.delimiter}${current}`,
  };
}

function patchWindowsElectronIcon() {
  if (process.platform !== 'win32') return;
  const patchScript = path.join(scriptDirectory, 'patch-windows-electron-icon.mjs');
  // 每次启动都强制把知远 icon.ico 写入 dist/electron.exe，避免任务栏继续显示原子图标。
  const result = spawnSync(process.execPath, [patchScript, '--force'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      FORCE_PATCH_ELECTRON_ICON: '1',
    },
  });
  if (result.status !== 0) {
    console.warn('[electron:dev] Windows electron icon patch did not complete cleanly.');
  }
}

async function main() {
  if (!fs.existsSync(localBinDirectory)) {
    throw new Error(`Missing ${localBinDirectory}; run npm/bun install first.`);
  }

  // Windows: embed the app icon into development electron.exe so the taskbar
  // does not keep showing the default Electron atom logo.
  patchWindowsElectronIcon();

  const port = await resolveDevPort();
  const startUrl = `http://localhost:${port}`;
  // 必须直启 dist/electron.exe。走 node_modules/.bin 的 shim 时，Windows 任务栏
  // 会按 shim 身份显示 Electron 默认原子图标，忽略已写入 dist 的知远图标。
  const electronBinary =
    process.platform === 'win32'
      ? path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
      : 'electron';
  if (process.platform === 'win32' && !fs.existsSync(electronBinary)) {
    throw new Error(`Missing ${electronBinary}; run npm/bun install first.`);
  }

  if (process.platform === 'win32') {
    const shortcutScript = path.join(scriptDirectory, 'write-windows-dev-shortcut.cjs');
    const shortcutResult = spawnSync(electronBinary, [shortcutScript], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    if (shortcutResult.status !== 0) {
      console.warn('[electron:dev] Windows taskbar shortcut was not created.');
    }
  }

  console.log(`[electron:dev] Using port ${port} (${startUrl})`);

  // Env is set on each command so Windows does not need cross-env for these vars.
  const sharedEnv = withLocalBinPath({
    ...process.env,
    VITE_SKIP_ELECTRON: '1',
    VITE_DEV_PORT: String(port),
    NODE_ENV: 'development',
    ELECTRON_START_URL: startUrl,
  });

  // Same startup contract as the original package.json script:
  // concurrently Vite + (wait-on assets → wait-on .electron-ready → electron)
  const quotedElectron =
    process.platform === 'win32' ? `"${electronBinary}"` : electronBinary;
  const { result } = concurrently(
    [
      {
        name: 'vite',
        command: `vite --port ${port}`,
        env: sharedEnv,
        cwd: projectRoot,
      },
      {
        name: 'electron',
        command: [
          `wait-on -l -t 120000 -i 1000 -s 1 http-get://localhost:${port}/src/renderer/main.tsx http-get://localhost:${port}/src/renderer/index.css`,
          'wait-on -l -t 120000 -i 1000 dist-electron/.electron-ready',
          `${quotedElectron} --remote-debugging-port=9222 .`,
        ].join(' && '),
        env: sharedEnv,
        cwd: projectRoot,
      },
    ],
    {
      cwd: projectRoot,
      killOthers: ['failure', 'success'],
      killSignal: 'SIGKILL',
    },
  );

  try {
    await result;
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('[electron:dev]', error instanceof Error ? error.message : error);
  process.exit(1);
});
