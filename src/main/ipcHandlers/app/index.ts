/** App-level IPC: hardware, network, logs, auto-launch, prevent-sleep, window controls, devtools. */
import { app, BrowserWindow, dialog, type WebContents } from 'electron';

import { ensureZipFileName } from '../cowork/fileExportHelpers';
import path from 'path';

import { shell } from 'electron';

import { buildLogExportFileName } from '../cowork/fileExportHelpers';
import type { SqliteStore } from '../../sqliteStore';
import { getLogFilePath, getRecentMainLogEntries } from '../../logger';
import {
  formatDiagnosticsSummaryText,
  getSystemDiagnosticsSnapshot,
} from '../../diagnostics/systemDiagnostics';
import { getAutoLaunchEnabled, setAutoLaunchEnabled } from '../../autoLaunchManager';
import { getNvidiaSmiSnapshot } from '../../libs/nvidiaSmi';
import { getSystemMemorySnapshot } from '../../libs/systemMemory';
import { exportLogsZip } from '../../libs/logExport';
import { getCoworkLogPath } from '../../libs/coworkLogger';
import { APP_DATA_DIR_NAME } from '../../appConstants';
import { AppQuitOrigin, recordAppQuitOrigin } from '../../appQuitOrigin';
import {
  appEventContract,
  NetworkStatus,
  type WindowMenuPosition,
} from '../../../shared/ipc/appEventContract';
import { appSystemContract } from '../../../shared/ipc/appSystemContract';
import { hardwareContract } from '../../../shared/ipc/hardwareContract';
import { handleIpcContract, handleIpcContractSubset } from '../../ipc/handleIpcContract';
import { listenToWindowIpcEvent } from '../../ipc/listenToWindowIpcEvent';
import {
  resolveEffectiveInferenceEdition,
  usesBundledLlamaCppRuntime,
} from '../../libs/inferenceEditionPolicy';

/** 2026/09/14 lisa  打开开发调试面板 **/
const canUseDevTools = (isDev: () => boolean): boolean => isDev() || !app.isPackaged;

export const openDevToolsWindow = (webContents: WebContents): void => {
  // Docked mode is more discoverable than a detached window that can open
  // off-screen on multi-monitor Windows setups.
  webContents.openDevTools({ mode: 'right', activate: true });
};

export const toggleDevToolsForSender = (
  webContents: WebContents | null | undefined,
  isDev: () => boolean,
): boolean => {
  if (!canUseDevTools(isDev)) return false;
  if (!webContents || webContents.isDestroyed()) return false;
  if (webContents.isDevToolsOpened()) webContents.closeDevTools();
  else openDevToolsWindow(webContents);
  return true;
};

export interface AppIpcDeps {
  isDev: () => boolean;
  isEnterprise: () => boolean;
  getStore: () => SqliteStore;
  setPreventSleepBlockerEnabled: (enabled: boolean) => void;
  showSystemMenu: (position?: WindowMenuPosition) => void;
  reconcileCcConnectChannelSidecars: () => Promise<void>;
  getMainWindow: () => Electron.BrowserWindow | null;
  hasIMGatewayManager: () => boolean;
}

export const registerAppIpc = (deps: AppIpcDeps): void => {
  handleIpcContract(hardwareContract, {
    nvidiaSmi: () => getNvidiaSmiSnapshot(),
    systemMemory: () => getSystemMemorySnapshot(),
  });

  listenToWindowIpcEvent(
    appEventContract.networkStatusChange,
    deps.getMainWindow,
    (_window, status) => {
      console.log(`[Main] Network status changed: ${status}`);

      if (status === NetworkStatus.Online && deps.hasIMGatewayManager()) {
        console.log('[Main] Network restored, reconciling channel sidecars...');
        void deps.reconcileCcConnectChannelSidecars();
      }
    },
  );
  listenToWindowIpcEvent(
    appEventContract.logFromRenderer,
    deps.getMainWindow,
    (_window, level, tag, message) => {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(`[Renderer][${tag}] ${message}`);
    },
  );

  handleIpcContractSubset(appSystemContract, {
    logGetPath: async () => {
      return getLogFilePath();
    },

    logOpenFolder: async () => {
      const logPath = getLogFilePath();
      if (logPath) {
        shell.showItemInFolder(logPath);
      }
    },

    logExportZip: async event => {
      try {
        const ownerWindow = BrowserWindow.fromWebContents(event.sender);
        if (!ownerWindow || ownerWindow.isDestroyed()) {
          return { success: false, error: 'Window is not available' };
        }

        const saveOptions = {
          title: 'Export Logs',
          defaultPath: path.join(app.getPath('downloads'), buildLogExportFileName()),
          filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
        };

        const saveResult = await dialog.showSaveDialog(ownerWindow, saveOptions);

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: true, canceled: true };
        }

        const outputPath = ensureZipFileName(saveResult.filePath);
        const diagnosticsSnapshot = await getSystemDiagnosticsSnapshot();
        const diagnosticsJson = JSON.stringify(diagnosticsSnapshot, null, 2);
        const diagnosticsSummary = formatDiagnosticsSummaryText(diagnosticsSnapshot);

        const archiveResult = await exportLogsZip({
          outputPath,
          virtualEntries: [
            { archiveName: 'system-diagnostics.json', content: diagnosticsJson },
            { archiveName: 'system-summary.txt', content: diagnosticsSummary },
          ],
          entries: [
            ...getRecentMainLogEntries(),
            { archiveName: 'cowork.log', filePath: getCoworkLogPath() },
            ...(process.platform === 'win32'
              ? [
                  {
                    archiveName: 'install-timing.log',
                    filePath: path.join(
                      app.getPath('appData'),
                      APP_DATA_DIR_NAME,
                      'install-timing.log',
                    ),
                  },
                ]
              : []),
          ],
        });

        return {
          success: true,
          canceled: false,
          path: outputPath,
          missingEntries: archiveResult.missingEntries,
        };
      } catch (error) {
        console.error('[LogExport] export failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to export logs',
        };
      }
    },

    // Auto-launch IPC handlers
    // Use SQLite deps.getStore() as the source of truth for UI state, because
    // app.getLoginItemSettings() returns unreliable values on macOS and
    // requires matching args on Windows.
    autoLaunchGet: async () => {
      const stored = deps.getStore().get<boolean>('auto_launch_enabled');
      // Fall back to OS API if SQLite has no record yet (e.g. upgraded from older version)
      const enabled = stored ?? getAutoLaunchEnabled();
      return { enabled };
    },

    autoLaunchSet: async (_event, enabled) => {
      try {
        setAutoLaunchEnabled(enabled);
        deps.getStore().set('auto_launch_enabled', enabled);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set auto-launch',
        };
      }
    },

    preventSleepGet: async () => {
      const enabled = deps.getStore().get<boolean>('prevent_sleep_enabled') ?? false;
      return { enabled };
    },

    preventSleepSet: async (_event, enabled) => {
      try {
        deps.setPreventSleepBlockerEnabled(enabled);
        deps.getStore().set('prevent_sleep_enabled', enabled);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set prevent-sleep',
        };
      }
    },

    appRelaunch: async () => {
      console.log('[Main] app:relaunch requested, scheduling restart...');
      recordAppQuitOrigin(AppQuitOrigin.RendererRelaunch);
      app.relaunch();
      app.quit();
    },
  });

  // Window control IPC handlers
  listenToWindowIpcEvent(appEventContract.windowMinimize, deps.getMainWindow, window => {
    window.minimize();
  });

  listenToWindowIpcEvent(appEventContract.windowToggleMaximize, deps.getMainWindow, window => {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });

  listenToWindowIpcEvent(appEventContract.windowClose, deps.getMainWindow, window => {
    window.close();
  });

  listenToWindowIpcEvent(appEventContract.windowShowSystemMenu, deps.getMainWindow, (_, position) =>
    deps.showSystemMenu(position),
  );

  handleIpcContractSubset(appSystemContract, {
    windowIsMaximized: async () => {
      return deps.getMainWindow()?.isMaximized() ?? false;
    },
    windowOpenDevTools: async event => {
      if (!canUseDevTools(deps.isDev)) return false;
      const target = event.sender?.isDestroyed?.()
        ? deps.getMainWindow()?.webContents
        : event.sender;
      if (!target || target.isDestroyed()) return false;
      openDevToolsWindow(target);
      return true;
    },

    appGetVersion: async () => app.getVersion(),
    appIsDev: async () => canUseDevTools(deps.isDev), // 开发环境打开调试面板
    appIsEnterprise: async () => deps.isEnterprise(),
    appGetSystemLocale: async () => app.getLocale(),
    appGetInferenceEdition: async () => resolveEffectiveInferenceEdition(),
    appUsesBundledLlamaCppRuntime: async () => usesBundledLlamaCppRuntime(),
  });
};
