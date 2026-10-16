/** Main window creation, lifecycle wiring, state persistence and dev-server load. */
import fs from 'fs';
import path from 'path';

import { app, nativeImage, shell, BrowserWindow } from 'electron';

import { DEV_SERVER_URL, isDev, isLinuxRendererSmoke, isMac } from './appEnv';
import { rt } from './runtimeState';
import { PRELOAD_PATH, applyWindowsWindowIcon } from './windowBranding';
import { emitWindowState, schedulePersistAppWindowState } from './windowManagement';
import { openDevToolsWindow, toggleDevToolsForSender } from './appIpc';
import { isWecomAuthUrl } from './windowSecurity';
import { logAppQuitContextOnce } from './appLifecycle';
import { AppQuitOrigin, recordAppQuitOrigin } from '../appQuitOrigin';
import { getCronJobService } from '../ipcHandlers/scheduledTask';
import { isAutoLaunched } from '../autoLaunchManager';
import { getStore } from './runtimeServices';
import { getAppIconPath } from './windowBranding';
import { runtimeAppName, isWindows } from './appEnv';
import {
  AppWindowStoreKey,
  MIN_APP_WINDOW_HEIGHT,
  MIN_APP_WINDOW_WIDTH,
  resolveInitialAppWindowState,
} from '../windowState';
import { registerContextMenu } from '../contextMenu';
import { setLanguage } from '../i18n';
import { createTray } from '../trayManager';
import {
  getDisplayWorkAreas,
  getTitleBarOverlayOptions,
  persistAppWindowState,
  scheduleReload,
} from './windowManagement';
import { getInitialTheme } from './appConfigSettings';
import {
  migrateLegacyScheduledTasksToCanonical,
  migrateLegacyScheduledTaskRunsToCanonical,
} from '../../scheduledTask/migrate';
import { SqliteScheduledTaskStore } from '../../scheduledTask/sqliteScheduledTaskStore';

export const createMainWindow = (): void => {
  // 创建主窗口
  const createWindow = () => {
    // 如果窗口已经存在，就不再创建新窗口
    if (rt.mainWindow) {
      if (rt.mainWindow.isMinimized()) rt.mainWindow.restore();
      if (!rt.mainWindow.isVisible()) rt.mainWindow.show();
      if (!rt.mainWindow.isFocused()) rt.mainWindow.focus();
      return;
    }

    const initialWindowState = resolveInitialAppWindowState(
      getStore().get(AppWindowStoreKey.State),
      getDisplayWorkAreas(),
    );
    const { isMaximized: shouldRestoreMaximized, ...initialWindowBounds } = initialWindowState;

    rt.mainWindow = new BrowserWindow({
      ...initialWindowBounds,
      title: runtimeAppName,
      icon: getAppIconPath(),
      ...(isMac
        ? {
            titleBarStyle: 'hiddenInset' as const,
            trafficLightPosition: { x: 12, y: 20 },
          }
        : isWindows
          ? {
              frame: false,
              titleBarStyle: 'hidden' as const,
            }
          : {
              titleBarStyle: 'hidden' as const,
              titleBarOverlay: getTitleBarOverlayOptions(),
            }),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        // 2026/09/17 lixiang  开发环境关闭 webSecurity，页面 fetch 才能跨域并出现在 DevTools Network
        webSecurity: !isDev,
        preload: PRELOAD_PATH,
        // 2026/09/21 lixiang  恢复 Chromium 默认节流：窗口隐藏/最小化后暂停渲染进程定时器与动画，
        // 降低常驻内存与 CPU（下载、流式对话均在主进程完成，不受影响）。
        // officePreviewRenderer 的隐藏截图窗口仍单独关闭节流，勿在此全局放开。
        backgroundThrottling: true,
        devTools: isDev,
        spellcheck: false,
        enableWebSQL: false,
        autoplayPolicy: 'document-user-activation-required',
        disableDialogs: true,
        navigateOnDragDrop: false,
      },
      backgroundColor: getInitialTheme() === 'dark' ? '#0F1117' : '#F8F9FB',
      show: isLinuxRendererSmoke,
      autoHideMenuBar: true,
      enableLargerThanScreen: false,
    });

    // Windows 任务栏在设置 AppUserModelID 后仍要显式套用 ico，否则继续显示 Electron 图标
    applyWindowsWindowIcon(rt.mainWindow);

    // 设置 macOS Dock 图标（开发模式下 Electron 默认图标不是应用 Logo）
    if (isMac && isDev) {
      // Use a PNG with extra transparent padding. NativeImage reliably loads
      // this in development and it keeps the Dock visual size below the
      // packaged app's full-bleed icon.
      const iconPath = path.join(__dirname, '../build/icons/png/mac-dev-dock.png');
      if (fs.existsSync(iconPath)) {
        app.dock.setIcon(nativeImage.createFromPath(iconPath));
      }
    }

    // 禁用窗口菜单
    rt.mainWindow.setMenu(null);
    const unregisterContextMenu = registerContextMenu(rt.mainWindow);

    // 处理 window.open 请求（企微 SDK 授权弹窗等）
    rt.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isWecomAuthUrl(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 950,
            height: 640,
            title: '企业微信授权',
            autoHideMenuBar: true,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
            },
          },
        };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // 监听子窗口创建事件（企微授权弹窗安全限制）
    rt.mainWindow.webContents.on('did-create-window', childWindow => {
      // 限制子窗口只能导航到企微域名，防止被劫持到其他站点
      childWindow.webContents.on('will-navigate', (event, navUrl) => {
        if (!isWecomAuthUrl(navUrl)) {
          event.preventDefault();
        }
      });
    });

    // 设置窗口的最小尺寸
    rt.mainWindow.setMinimumSize(MIN_APP_WINDOW_WIDTH, MIN_APP_WINDOW_HEIGHT);
    if (shouldRestoreMaximized) {
      rt.mainWindow.maximize();
    }

    // 设置窗口加载超时
    const loadTimeout = setTimeout(() => {
      if (rt.mainWindow && rt.mainWindow.webContents.isLoadingMainFrame()) {
        console.log('Window load timed out, attempting to reload...');
        scheduleReload('load-timeout');
      }
    }, 30000);

    // 清除超时
    rt.mainWindow.webContents.once('did-finish-load', () => {
      clearTimeout(loadTimeout);
    });
    rt.mainWindow.webContents.on('did-finish-load', () => {
      emitWindowState();
    });

    // 处理窗口关闭
    rt.mainWindow.on('close', e => {
      if (rt.windowStateSaveTimer) {
        clearTimeout(rt.windowStateSaveTimer);
        rt.windowStateSaveTimer = null;
      }
      persistAppWindowState();

      // In development, close should actually quit so `npm run electron:dev`
      // restarts from a clean process. In production we keep tray behavior.
      if (rt.mainWindow && !rt.isQuitting && !isDev) {
        e.preventDefault();
        rt.mainWindow.hide();
      }
    });

    if (isDev) {
      // 开发环境
      const maxRetries = 3;
      let retryCount = 0;

      const tryLoadURL = () => {
        rt.mainWindow?.loadURL(DEV_SERVER_URL).catch(err => {
          console.error('Failed to load URL:', err);
          retryCount++;

          if (retryCount < maxRetries) {
            console.log(`Retrying to load URL (${retryCount}/${maxRetries})...`);
            setTimeout(tryLoadURL, 3000);
          } else {
            console.error('Failed to load URL after maximum retries');
            if (rt.mainWindow && !rt.mainWindow.isDestroyed()) {
              rt.mainWindow.loadFile(path.join(__dirname, '../resources/error.html'));
            }
          }
        });
      };

      tryLoadURL();

      // 开发环境默认在窗口右侧打开 DevTools；关闭后可用 F12 / Ctrl+Shift+I
      const openDevToolsIfNeeded = () => {
        if (!rt.mainWindow || rt.mainWindow.isDestroyed()) return;
        openDevToolsWindow(rt.mainWindow.webContents);
      };
      // Wait until the page is ready so the docked panel is attached to a live view.
      rt.mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(openDevToolsIfNeeded, 300);
      });
      rt.mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        const isToggleShortcut =
          input.key === 'F12' ||
          ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i');
        if (!isToggleShortcut) return;
        event.preventDefault();
        toggleDevToolsForSender(rt.mainWindow?.webContents);
      });
    } else {
      // 生产环境
      rt.mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    // 添加错误处理
    rt.mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        console.error('Page failed to load:', errorCode, errorDescription);
        // 如果加载失败，尝试重新加载
        if (isDev) {
          setTimeout(() => {
            scheduleReload('did-fail-load');
          }, 3000);
        }
      },
    );

    // 当窗口关闭时，清除引用
    rt.mainWindow.on('closed', () => {
      unregisterContextMenu();
      if (rt.windowStateSaveTimer) {
        clearTimeout(rt.windowStateSaveTimer);
        rt.windowStateSaveTimer = null;
      }
      rt.mainWindow = null;
    });

    const forwardWindowState = () => emitWindowState();
    const forwardAndPersistWindowState = () => {
      emitWindowState();
      schedulePersistAppWindowState();
    };
    rt.mainWindow.on('resize', schedulePersistAppWindowState);
    rt.mainWindow.on('move', schedulePersistAppWindowState);
    rt.mainWindow.on('maximize', forwardAndPersistWindowState);
    rt.mainWindow.on('unmaximize', forwardAndPersistWindowState);
    rt.mainWindow.on('enter-full-screen', forwardAndPersistWindowState);
    rt.mainWindow.on('leave-full-screen', forwardAndPersistWindowState);
    rt.mainWindow.on('focus', forwardWindowState);
    rt.mainWindow.on('blur', forwardWindowState);
    rt.mainWindow.on('session-end', () => {
      recordAppQuitOrigin(AppQuitOrigin.OperatingSystemSessionEnd);
      logAppQuitContextOnce();
    });

    // Some Linux desktop/GPU combinations finish loading without emitting ready-to-show.
    // Show the loaded window so the first launch does not remain hidden until a second click.
    rt.mainWindow.webContents.once('did-finish-load', () => {
      if (
        rt.mainWindow &&
        !rt.mainWindow.isDestroyed() &&
        !rt.mainWindow.isVisible() &&
        (isLinuxRendererSmoke || !isAutoLaunched())
      ) {
        console.warn(
          '[MainWindow] Page loaded before ready-to-show; showing the initial window now.',
        );
        rt.mainWindow.show();
      }
    });

    // 等待内容加载完成后再显示窗口
    rt.mainWindow.once('ready-to-show', () => {
      // 2026/09/20 lixiang  显示前再套一次图标，避免 Windows 任务栏仍缓存 electron 默认图标
      if (rt.mainWindow && !rt.mainWindow.isDestroyed()) {
        applyWindowsWindowIcon(rt.mainWindow);
      }
      emitWindowState();
      // 开机自启时不显示窗口，仅显示托盘图标
      if (isLinuxRendererSmoke || !isAutoLaunched()) {
        rt.mainWindow?.show();
        if (rt.mainWindow && !rt.mainWindow.isDestroyed()) {
          applyWindowsWindowIcon(rt.mainWindow);
        }
      }
      // Initialize main-process i18n from stored language before creating UI elements.
      const initLang = getStore().get<{ language?: string }>('app_config')?.language;
      setLanguage(initLang === 'en' ? 'en' : 'zh');
      // 窗口就绪后创建系统托盘
      createTray(() => rt.mainWindow);

      // Start cron polling after the window is ready.
      (async () => {
        try {
          getCronJobService().startPolling();
        } catch (err) {
          console.warn('[Main] Canonical scheduler not available yet:', err);
        }

        // One-time migration: import legacy SQLite task records into the
        // canonical scheduler. No task is delegated to another runtime.
        migrateLegacyScheduledTasksToCanonical({
          db: getStore().getDatabase(),
          getKv: key => getStore().get(key),
          setKv: (key, value) => getStore().set(key, value),
          store: new SqliteScheduledTaskStore(getStore().getDatabase()),
        }).catch(err => {
          console.warn('[Main] Canonical scheduled-task migration failed:', err);
        });
        migrateLegacyScheduledTaskRunsToCanonical({
          db: getStore().getDatabase(),
          getKv: key => getStore().get(key),
          setKv: (key, value) => getStore().set(key, value),
          store: new SqliteScheduledTaskStore(getStore().getDatabase()),
        }).catch(err => {
          console.warn('[Main] Canonical scheduled-task Run migration failed:', err);
        });
      })();
    });
  };

  createWindow();
};
