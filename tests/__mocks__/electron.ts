// Vitest mock for electron — CI runs without electron binary (ELECTRON_SKIP_BINARY_DOWNLOAD=1)
import { EventEmitter } from 'events';

if (!process.resourcesPath) {
  Object.defineProperty(process, 'resourcesPath', { value: process.cwd() });
}

export const app = {
  getPath: () => '',
  getName: () => 'ZhiYuan Agent',
  getVersion: () => '0.0.0',
  isPackaged: true,
  on: () => {},
  whenReady: () => Promise.resolve(),
  quit: () => {},
  exit: () => {},
  relaunch: () => {},
  getLoginItemSettings: () => ({ openAtLogin: false }),
  setLoginItemSettings: () => {},
};

export const BrowserWindow = {
  getAllWindows: () => [],
  fromWebContents: () => null,
};

export const ipcMain = Object.assign(new EventEmitter(), {
  handle: () => {},
  handleOnce: () => {},
  removeHandler: () => {},
});

export const ipcRenderer = Object.assign(new EventEmitter(), {
  invoke: () => Promise.resolve(),
  send: () => {},
  sendSync: () => null,
  postMessage: () => {},
});

export const shell = {
  openPath: () => Promise.resolve(''),
  openExternal: () => Promise.resolve(),
  showItemInFolder: () => {},
  trashItem: () => {},
};

export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
  showSaveDialog: () => Promise.resolve({ canceled: true, filePath: '' }),
  showMessageBox: () => Promise.resolve({ response: 0 }),
  showErrorBox: () => {},
};

export const Menu = {
  buildFromTemplate: () => ({ popup: () => {} }),
  setApplicationMenu: () => {},
};

export const Tray = function () {
  return { on: () => {}, setToolTip: () => {}, setContextMenu: () => {}, destroy: () => {} };
};

export const nativeImage = {
  createFromPath: () => ({ resize: () => ({ toDataURL: () => '' }) }),
  createFromDataURL: () => ({}),
};

export const nativeTheme = {
  on: () => {},
  shouldUseDarkColors: false,
  themeSource: 'system',
};

export const net = {
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  request: () => ({ on: () => {}, end: () => {}, abort: () => {} }),
};

export const powerMonitor = {
  on: () => {},
  getSystemIdleTime: () => 0,
};

export const powerSaveBlocker = {
  start: () => 0,
  stop: () => {},
};

export const protocol = {
  registerFileProtocol: () => {},
  registerHttpProtocol: () => {},
  handle: () => {},
  isProtocolHandled: () => false,
};

export const screen = {
  getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
  getAllDisplays: () => [],
  on: () => {},
};

export const session = {
  defaultSession: {
    clearCache: () => Promise.resolve(),
    clearStorageData: () => Promise.resolve(),
  },
  fromPartition: () => session.defaultSession,
};

export const contextBridge = {
  exposeInMainWorld: () => {},
};

export const Notification = function () {
  return { show: () => {}, on: () => {}, close: () => {} };
};
