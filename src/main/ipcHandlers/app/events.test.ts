import { ipcMain } from 'electron';
import { afterEach, expect, test, vi } from 'vitest';

import { LogIpc, NetworkIpc, WindowIpc } from '../../../shared/ipc/channels';
import { registerAppIpc } from './index';

afterEach(() => {
  for (const channel of [
    WindowIpc.Minimize,
    WindowIpc.ToggleMaximize,
    WindowIpc.Close,
    WindowIpc.ShowSystemMenu,
    NetworkIpc.StatusChange,
    LogIpc.FromRenderer,
  ]) {
    ipcMain.removeAllListeners(channel);
  }
  vi.restoreAllMocks();
});

function register() {
  const webContents = { mainFrame: {}, isDestroyed: () => false };
  const window = {
    webContents,
    isDestroyed: () => false,
    isMaximized: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
  };
  const sender = { sender: webContents, senderFrame: webContents.mainFrame };
  const getMainWindow = vi.fn(() => window as unknown as Electron.BrowserWindow);
  const showSystemMenu = vi.fn();
  const reconcileCcConnectChannelSidecars = vi.fn(async () => {});
  registerAppIpc({
    getMainWindow,
    showSystemMenu,
    reconcileCcConnectChannelSidecars,
    hasIMGatewayManager: () => true,
    getStore: vi.fn(),
    isDev: () => false,
    isEnterprise: () => false,
    setPreventSleepBlockerEnabled: vi.fn(),
  });
  return { window, sender, getMainWindow, showSystemMenu, reconcileCcConnectChannelSidecars };
}

test('window commands require the current app main frame and no arguments', () => {
  const { window, sender, getMainWindow } = register();
  ipcMain.emit(WindowIpc.Minimize, { ...sender, sender: {} });
  ipcMain.emit(WindowIpc.Minimize, { ...sender, senderFrame: {} });
  ipcMain.emit(WindowIpc.Minimize, { ...sender, senderFrame: null });
  ipcMain.emit(WindowIpc.Minimize, sender, 'extra');
  expect(window.minimize).not.toHaveBeenCalled();

  ipcMain.emit(WindowIpc.Minimize, sender);
  ipcMain.emit(WindowIpc.ToggleMaximize, sender);
  ipcMain.emit(WindowIpc.ToggleMaximize, sender);
  ipcMain.emit(WindowIpc.Close, sender);
  expect(window.minimize).toHaveBeenCalledOnce();
  expect(window.maximize).toHaveBeenCalledOnce();
  expect(window.unmaximize).toHaveBeenCalledOnce();
  expect(window.close).toHaveBeenCalledOnce();

  getMainWindow.mockReturnValueOnce({
    ...window,
    webContents: { ...window.webContents },
  } as unknown as Electron.BrowserWindow);
  ipcMain.emit(WindowIpc.Close, sender);
  expect(window.close).toHaveBeenCalledOnce();
});

test('system menu retains finite coordinates and optional position fallback', () => {
  const { sender, showSystemMenu } = register();
  ipcMain.emit(WindowIpc.ShowSystemMenu, sender, { x: '3', y: 0 });
  ipcMain.emit(WindowIpc.ShowSystemMenu, sender, { x: Infinity });
  ipcMain.emit(WindowIpc.ShowSystemMenu, { ...sender, senderFrame: null }, { x: 4 });
  expect(showSystemMenu).not.toHaveBeenCalled();

  ipcMain.emit(WindowIpc.ShowSystemMenu, sender, { x: 2.5, y: -1 });
  ipcMain.emit(WindowIpc.ShowSystemMenu, sender, { x: 3 });
  ipcMain.emit(WindowIpc.ShowSystemMenu, sender);
  expect(showSystemMenu.mock.calls).toEqual([[{ x: 2.5, y: -1 }], [{ x: 3 }], [undefined]]);
});

test('network accepts only browser transitions from the app main frame', () => {
  const { sender, reconcileCcConnectChannelSidecars } = register();
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  ipcMain.emit(NetworkIpc.StatusChange, { ...sender, senderFrame: {} }, 'online');
  ipcMain.emit(NetworkIpc.StatusChange, sender, 'bogus');
  ipcMain.emit(NetworkIpc.StatusChange, sender, 'online', 'extra');
  expect(log).not.toHaveBeenCalled();
  expect(reconcileCcConnectChannelSidecars).not.toHaveBeenCalled();

  ipcMain.emit(NetworkIpc.StatusChange, sender, 'offline');
  expect(log).toHaveBeenCalledWith('[Main] Network status changed: offline');
  expect(reconcileCcConnectChannelSidecars).not.toHaveBeenCalled();
  ipcMain.emit(NetworkIpc.StatusChange, sender, 'online');
  expect(reconcileCcConnectChannelSidecars).toHaveBeenCalledOnce();
});

test('renderer logging accepts the existing string tuple only from the app main frame', () => {
  const { sender } = register();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});

  ipcMain.emit(LogIpc.FromRenderer, { ...sender, senderFrame: {} }, 'warn', 'App', 'blocked');
  ipcMain.emit(LogIpc.FromRenderer, sender, 'warn', 'App', { message: 'blocked' });
  expect(warn).not.toHaveBeenCalled();

  ipcMain.emit(LogIpc.FromRenderer, sender, 'warn', 'App', 'notice');
  ipcMain.emit(LogIpc.FromRenderer, sender, 'info', 'App', 'ready');
  expect(warn).toHaveBeenCalledExactlyOnceWith('[Renderer][App] notice');
  expect(log).toHaveBeenCalledExactlyOnceWith('[Renderer][App] ready');
});
