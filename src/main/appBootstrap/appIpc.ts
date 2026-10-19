/** App-level IPC: hardware, network, logs, auto-launch, prevent-sleep, window controls, devtools. */
import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';

import { isDev, isEnterprise } from './appEnv';
import { rt } from './runtimeState';
import { getStore, setPreventSleepBlockerEnabled } from './runtimeServices';
import { showSystemMenu } from './windowManagement';
import { ensureZipFileName } from '../coworkIpc/fileExportHelpers';
import path from 'path';

import { shell } from 'electron';

import { buildLogExportFileName } from '../coworkIpc/fileExportHelpers';
import { reconcileCcConnectChannelSidecars } from './ccConnectRuntime';
import { getLogFilePath, getRecentMainLogEntries } from '../logger';
import {
  formatDiagnosticsSummaryText,
  getSystemDiagnosticsSnapshot,
} from '../diagnostics/systemDiagnostics';
import { getAutoLaunchEnabled, setAutoLaunchEnabled } from '../autoLaunchManager';
import { getNvidiaSmiSnapshot } from '../libs/nvidiaSmi';
import { getSystemMemorySnapshot } from '../libs/systemMemory';
import { exportLogsZip } from '../libs/logExport';
import { getCoworkLogPath } from '../libs/coworkLogger';
import { APP_DATA_DIR_NAME } from '../appConstants';
import { AppQuitOrigin, recordAppQuitOrigin } from '../appQuitOrigin';
import { HardwareIpc } from '../../shared/ipc/channels';
import { appSystemContract } from '../../shared/ipc/appSystemContract';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';
import {
  resolveEffectiveInferenceEdition,
  usesBundledLlamaCppRuntime,
} from '../libs/inferenceEditionPolicy';

/** 2026/09/14 lisa  打开开发调试面板 **/
const canUseDevTools = (): boolean => isDev || !app.isPackaged;

export const openDevToolsWindow = (webContents: WebContents): void => {
  // Docked mode is more discoverable than a detached window that can open
  // off-screen on multi-monitor Windows setups.
  webContents.openDevTools({ mode: 'right', activate: true });
  if (rt.mainWindow && !rt.mainWindow.isDestroyed()) {
    rt.mainWindow.show();
    rt.mainWindow.focus();
  }
};

export const toggleDevToolsForSender = (webContents?: WebContents | null): boolean => {
  if (!canUseDevTools()) return false;
  const target =
    webContents && !webContents.isDestroyed() ? webContents : rt.mainWindow?.webContents;
  if (!target || target.isDestroyed()) return false;
  if (target.isDevToolsOpened()) target.closeDevTools();
  else openDevToolsWindow(target);
  return true;
};

export const registerAppIpc = (): void => {
  ipcMain.handle('hardware:nvidia-smi', async () => getNvidiaSmiSnapshot());
  ipcMain.handle(HardwareIpc.SystemMemory, async () => getSystemMemorySnapshot());

  // Network status change handler
  // Remove any existing listener first to avoid duplicate registrations
  ipcMain.removeAllListeners('network:status-change');
  ipcMain.on('network:status-change', (_event, status: 'online' | 'offline') => {
    console.log(`[Main] Network status changed: ${status}`);

    if (status === 'online' && rt.imGatewayManager) {
      console.log('[Main] Network restored, reconciling channel sidecars...');
      void reconcileCcConnectChannelSidecars();
    }
  });

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
    // Use SQLite rt.store as the source of truth for UI state, because
    // app.getLoginItemSettings() returns unreliable values on macOS and
    // requires matching args on Windows.
    autoLaunchGet: async () => {
      const stored = getStore().get<boolean>('auto_launch_enabled');
      // Fall back to OS API if SQLite has no record yet (e.g. upgraded from older version)
      const enabled = stored ?? getAutoLaunchEnabled();
      return { enabled };
    },

    autoLaunchSet: async (_event, enabled) => {
      try {
        setAutoLaunchEnabled(enabled);
        getStore().set('auto_launch_enabled', enabled);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set auto-launch',
        };
      }
    },

    preventSleepGet: async () => {
      const enabled = getStore().get<boolean>('prevent_sleep_enabled') ?? false;
      return { enabled };
    },

    preventSleepSet: async (_event, enabled) => {
      try {
        setPreventSleepBlockerEnabled(enabled);
        getStore().set('prevent_sleep_enabled', enabled);
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
  ipcMain.on('window-minimize', () => {
    rt.mainWindow?.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (rt.mainWindow?.isMaximized()) {
      rt.mainWindow.unmaximize();
    } else {
      rt.mainWindow?.maximize();
    }
  });

  ipcMain.on('window-close', () => {
    rt.mainWindow?.close();
  });

  ipcMain.on(
    'window:showSystemMenu',
    (_event, position: { x?: number; y?: number } | undefined) => {
      showSystemMenu(position);
    },
  );

  handleIpcContractSubset(appSystemContract, {
    windowIsMaximized: async () => {
      return rt.mainWindow?.isMaximized() ?? false;
    },
    windowToggleDevTools: async event => toggleDevToolsForSender(event.sender),
    windowOpenDevTools: async event => {
      if (!canUseDevTools()) return false;
      const target = event.sender?.isDestroyed?.() ? rt.mainWindow?.webContents : event.sender;
      if (!target || target.isDestroyed()) return false;
      openDevToolsWindow(target);
      return true;
    },

    appGetVersion: async () => app.getVersion(),
    appIsDev: async () => canUseDevTools(), // 开发环境打开调试面板
    appIsEnterprise: async () => isEnterprise,
    appGetSystemLocale: async () => app.getLocale(),
    appGetInferenceEdition: async () => resolveEffectiveInferenceEdition(),
    appUsesBundledLlamaCppRuntime: async () => usesBundledLlamaCppRuntime(),
  });
};
