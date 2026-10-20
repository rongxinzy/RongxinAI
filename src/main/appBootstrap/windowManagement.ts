import { Menu, screen, type WebContents } from 'electron';

import { isMac, isWindows, TITLEBAR_COLORS, TITLEBAR_HEIGHT } from './appEnv';
import { lifecycleRuntime } from './lifecycleRuntimeState';
import { getStore } from './runtimeServices';
import { AppWindowStoreKey, type WindowRectangle } from '../windowState';
import type { AppConfigSettings } from './appConfigSettings';
import { resolveThemeFromConfig } from './appConfigSettings';

const WINDOW_STATE_SAVE_DEBOUNCE_MS = 300;
const MIN_RELOAD_INTERVAL_MS = 5000;

export const getTitleBarOverlayOptions = () => {
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  return {
    color: TITLEBAR_COLORS[theme].color,
    symbolColor: TITLEBAR_COLORS[theme].symbolColor,
    height: TITLEBAR_HEIGHT,
  };
};

export const updateTitleBarOverlay = () => {
  if (!lifecycleRuntime.mainWindow || lifecycleRuntime.mainWindow.isDestroyed()) return;
  if (!isMac && !isWindows) {
    lifecycleRuntime.mainWindow.setTitleBarOverlay(getTitleBarOverlayOptions());
  }
  // Also update the window background color to match the theme
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  lifecycleRuntime.mainWindow.setBackgroundColor(theme === 'dark' ? '#0F1117' : '#F8F9FB');
};

export const emitWindowState = () => {
  if (!lifecycleRuntime.mainWindow || lifecycleRuntime.mainWindow.isDestroyed()) return;
  if (lifecycleRuntime.mainWindow.webContents.isDestroyed()) return;
  lifecycleRuntime.mainWindow.webContents.send('window:state-changed', {
    isMaximized: lifecycleRuntime.mainWindow.isMaximized(),
    isFullscreen: lifecycleRuntime.mainWindow.isFullScreen(),
    isFocused: lifecycleRuntime.mainWindow.isFocused(),
  });
};

export const getDisplayWorkAreas = (): WindowRectangle[] => {
  return screen.getAllDisplays().map(display => display.workArea);
};

const getCurrentAppWindowState = () => {
  if (!lifecycleRuntime.mainWindow || lifecycleRuntime.mainWindow.isDestroyed()) return null;

  const bounds = lifecycleRuntime.mainWindow.isFullScreen()
    ? lifecycleRuntime.mainWindow.getNormalBounds()
    : lifecycleRuntime.mainWindow.isMaximized()
      ? lifecycleRuntime.mainWindow.getNormalBounds()
      : lifecycleRuntime.mainWindow.getBounds();

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: lifecycleRuntime.mainWindow.isMaximized(),
  };
};

export const persistAppWindowState = () => {
  const state = getCurrentAppWindowState();
  if (!state) return;
  getStore().set(AppWindowStoreKey.State, state);
};

export const schedulePersistAppWindowState = () => {
  if (lifecycleRuntime.windowStateSaveTimer) {
    clearTimeout(lifecycleRuntime.windowStateSaveTimer);
  }

  lifecycleRuntime.windowStateSaveTimer = setTimeout(() => {
    lifecycleRuntime.windowStateSaveTimer = null;
    persistAppWindowState();
  }, WINDOW_STATE_SAVE_DEBOUNCE_MS);
};

export const showSystemMenu = (position?: { x?: number; y?: number }) => {
  if (!isWindows) return;
  if (!lifecycleRuntime.mainWindow || lifecycleRuntime.mainWindow.isDestroyed()) return;

  const isMaximized = lifecycleRuntime.mainWindow.isMaximized();
  const menu = Menu.buildFromTemplate([
    { label: 'Restore', enabled: isMaximized, click: () => lifecycleRuntime.mainWindow?.restore() },
    { role: 'minimize' },
    {
      label: 'Maximize',
      enabled: !isMaximized,
      click: () => lifecycleRuntime.mainWindow?.maximize(),
    },
    { type: 'separator' },
    { role: 'close' },
  ]);

  menu.popup({
    window: lifecycleRuntime.mainWindow,
    x: Math.max(0, Math.round(position?.x ?? 0)),
    y: Math.max(0, Math.round(position?.y ?? 0)),
  });
};

export const scheduleReload = (reason: string, webContents?: WebContents) => {
  if (lifecycleRuntime.isQuitting) {
    console.debug(`[RendererProcess] Skipping reload during shutdown (${reason}).`);
    return;
  }
  const target = webContents ?? lifecycleRuntime.mainWindow?.webContents;
  if (!target || target.isDestroyed()) {
    return;
  }
  const now = Date.now();
  if (now - lifecycleRuntime.lastReloadAt < MIN_RELOAD_INTERVAL_MS) {
    console.warn(
      `Skipping reload (${reason}); last reload was ${now - lifecycleRuntime.lastReloadAt}ms ago.`,
    );
    return;
  }
  lifecycleRuntime.lastReloadAt = now;
  console.warn(`Reloading window due to ${reason}`);
  target.reloadIgnoringCache();
};
