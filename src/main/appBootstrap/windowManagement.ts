import { Menu, screen, type WebContents } from 'electron';

import { isMac, isWindows, TITLEBAR_COLORS, TITLEBAR_HEIGHT } from './appEnv';
import { rt } from './runtimeState';
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
  if (!rt.mainWindow || rt.mainWindow.isDestroyed()) return;
  if (!isMac && !isWindows) {
    rt.mainWindow.setTitleBarOverlay(getTitleBarOverlayOptions());
  }
  // Also update the window background color to match the theme
  const config = getStore().get<AppConfigSettings>('app_config');
  const theme = resolveThemeFromConfig(config);
  rt.mainWindow.setBackgroundColor(theme === 'dark' ? '#0F1117' : '#F8F9FB');
};

export const emitWindowState = () => {
  if (!rt.mainWindow || rt.mainWindow.isDestroyed()) return;
  if (rt.mainWindow.webContents.isDestroyed()) return;
  rt.mainWindow.webContents.send('window:state-changed', {
    isMaximized: rt.mainWindow.isMaximized(),
    isFullscreen: rt.mainWindow.isFullScreen(),
    isFocused: rt.mainWindow.isFocused(),
  });
};

export const getDisplayWorkAreas = (): WindowRectangle[] => {
  return screen.getAllDisplays().map(display => display.workArea);
};

const getCurrentAppWindowState = () => {
  if (!rt.mainWindow || rt.mainWindow.isDestroyed()) return null;

  const bounds = rt.mainWindow.isFullScreen()
    ? rt.mainWindow.getNormalBounds()
    : rt.mainWindow.isMaximized()
      ? rt.mainWindow.getNormalBounds()
      : rt.mainWindow.getBounds();

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: rt.mainWindow.isMaximized(),
  };
};

export const persistAppWindowState = () => {
  const state = getCurrentAppWindowState();
  if (!state) return;
  getStore().set(AppWindowStoreKey.State, state);
};

export const schedulePersistAppWindowState = () => {
  if (rt.windowStateSaveTimer) {
    clearTimeout(rt.windowStateSaveTimer);
  }

  rt.windowStateSaveTimer = setTimeout(() => {
    rt.windowStateSaveTimer = null;
    persistAppWindowState();
  }, WINDOW_STATE_SAVE_DEBOUNCE_MS);
};

export const showSystemMenu = (position?: { x?: number; y?: number }) => {
  if (!isWindows) return;
  if (!rt.mainWindow || rt.mainWindow.isDestroyed()) return;

  const isMaximized = rt.mainWindow.isMaximized();
  const menu = Menu.buildFromTemplate([
    { label: 'Restore', enabled: isMaximized, click: () => rt.mainWindow?.restore() },
    { role: 'minimize' },
    { label: 'Maximize', enabled: !isMaximized, click: () => rt.mainWindow?.maximize() },
    { type: 'separator' },
    { role: 'close' },
  ]);

  menu.popup({
    window: rt.mainWindow,
    x: Math.max(0, Math.round(position?.x ?? 0)),
    y: Math.max(0, Math.round(position?.y ?? 0)),
  });
};

export const scheduleReload = (reason: string, webContents?: WebContents) => {
  if (rt.isQuitting) {
    console.debug(`[RendererProcess] Skipping reload during shutdown (${reason}).`);
    return;
  }
  const target = webContents ?? rt.mainWindow?.webContents;
  if (!target || target.isDestroyed()) {
    return;
  }
  const now = Date.now();
  if (now - rt.lastReloadAt < MIN_RELOAD_INTERVAL_MS) {
    console.warn(`Skipping reload (${reason}); last reload was ${now - rt.lastReloadAt}ms ago.`);
    return;
  }
  rt.lastReloadAt = now;
  console.warn(`Reloading window due to ${reason}`);
  target.reloadIgnoringCache();
};
