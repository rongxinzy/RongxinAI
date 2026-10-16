import path from 'path';

import { app, protocol } from 'electron';

import {
  APP_NAME,
  APP_USER_MODEL_ID,
  ENTERPRISE_APP_NAME,
  resolveAppDataDirName,
} from '../appConstants';
import { isEnterpriseBuild } from '../enterpriseExtension/host';
import { ZHIYUAN_ENTERPRISE_RENDERER_PROTOCOL_PRIVILEGES } from '../enterpriseExtension/rendererProtocol';
import { ZHIYUAN_ENTERPRISE_RENDERER_SCHEME } from '../enterpriseExtension/rendererBridge';
import { configureRendererStartup } from '../rendererStartup';

/**
 * Static runtime environment facts shared across the main-process bootstrap.
 * Pure constants only — no side effects at import time.
 */
export const isEnterprise = isEnterpriseBuild({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  developmentExtensionPath: process.env.ZHIYUAN_ENTERPRISE_EXTENSION_DEV_PATH,
});
export const runtimeAppName = isEnterprise ? ENTERPRISE_APP_NAME : APP_NAME;

export const isDev = process.env.NODE_ENV === 'development';
const isLinux = process.platform === 'linux';
export const isMac = process.platform === 'darwin';
export const isWindows = process.platform === 'win32';
// The packaged Ubuntu smoke test needs an actual painted window. Production
// startup stays hidden until ready-to-show to avoid a flash of empty content.
export const isLinuxRendererSmoke =
  isLinux && process.argv.includes('--zhiyuan-linux-renderer-smoke');
export const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:5175';
const enableVerboseLogging =
  process.env.ELECTRON_ENABLE_LOGGING === '1' || process.env.ELECTRON_ENABLE_LOGGING === 'true';
export const reloadOnChildProcessGone =
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === '1' ||
  process.env.ELECTRON_RELOAD_ON_CHILD_PROCESS_GONE === 'true';
export const TITLEBAR_HEIGHT = 48;
export const TITLEBAR_COLORS = {
  dark: { color: '#0F1117', symbolColor: '#E4E5E9' },
  // Align light title bar with app light surface-muted tone to reduce visual contrast.
  light: { color: '#F3F4F6', symbolColor: '#1A1D23' },
} as const;

// 2026/09/21 lixiang  开发态用独立 AUMID，并配套开始菜单快捷方式（见 ensureWindowsTaskbarBrand），
// 避免 Windows 继续拿 Electron 默认原子图标的任务栏缓存。打包态仍用产品 AUMID。
export const WINDOWS_TASKBAR_APP_USER_MODEL_ID = app.isPackaged
  ? APP_USER_MODEL_ID
  : `${APP_USER_MODEL_ID}.dev`;

/** Set the app identity and register privileged schemes. Must run before app ready. */
export const applyAppIdentity = (): void => {
  // 设置应用程序名称
  app.name = runtimeAppName;
  app.setName(runtimeAppName);
  if (process.platform === 'win32') {
    app.setAppUserModelId(WINDOWS_TASKBAR_APP_USER_MODEL_ID);
  }

  protocol.registerSchemesAsPrivileged([
    {
      scheme: ZHIYUAN_ENTERPRISE_RENDERER_SCHEME,
      privileges: ZHIYUAN_ENTERPRISE_RENDERER_PROTOCOL_PRIVILEGES,
    },
    // 2026/09/17 lixiang  开发态 xr-net beacon，主进程请求可出现在 DevTools Network
    ...(process.env.NODE_ENV === 'development'
      ? [
          {
            scheme: 'xr-net',
            privileges: {
              standard: true,
              secure: true,
              supportFetchAPI: true,
              corsEnabled: true,
              bypassCSP: true,
            },
          },
        ]
      : []),
  ]);
};

/** Point the Electron userData directory at the branded app data folder. */
export const configureUserDataPath = (): void => {
  const memoryLeakTestUserDataPath = process.env.ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA;
  if (memoryLeakTestUserDataPath) {
    app.setPath('userData', memoryLeakTestUserDataPath);
    return;
  }

  const appDataPath = app.getPath('appData');
  const targetUserDataPath = path.join(appDataPath, resolveAppDataDirName(isEnterprise));
  const currentUserDataPath = app.getPath('userData');

  if (currentUserDataPath !== targetUserDataPath) {
    app.setPath('userData', targetUserDataPath);
    console.log(`[Main] userData path updated: ${currentUserDataPath} -> ${targetUserDataPath}`);
  }
};

/** Apply renderer-facing startup switches (software rendering, logging, cache). */
export const configureRendererSwitches = (): void => {
  const rendererStartup = configureRendererStartup({
    platform: process.platform,
    env: process.env,
    commandLine: app.commandLine,
    disableHardwareAcceleration: () => app.disableHardwareAcceleration(),
  });
  if (isLinux && rendererStartup.softwareRenderingEnabled) {
    console.log(
      '[RendererStartup] software rendering is enabled; set ZHIYUAN_ENABLE_GPU=1 to opt in to GPU acceleration',
    );
  }
  if (enableVerboseLogging) {
    app.commandLine.appendSwitch('enable-logging');
    app.commandLine.appendSwitch('v', '1');
  }

  // Mild Chromium cache/GPU tweaks (ceiling flags like max-old-space-size are not used:
  // they do not lower baseline RSS and can OOM heavy chat/document sessions).
  app.commandLine.appendSwitch('disable-gpu-memory-buffer-videos');
  app.commandLine.appendSwitch('disk-cache-size', String(50 * 1024 * 1024)); // 50MB
};
