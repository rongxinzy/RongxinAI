import { beforeEach, describe, expect, test, vi } from 'vitest';

// Regression harness for the 2026-10 bootstrap split: `createMainWindow` must
// actually run the extracted `createWindow` body. The original split shipped a
// wrapper that only declared the inner function, so the app booted without a
// window and the CI memory-leak scenario timed out waiting for the first view.
type Listener = (...args: unknown[]) => void;

interface MockWindow {
  listeners: Map<string, Listener[]>;
  webContentsListeners: Map<string, Listener[]>;
  loadFile: ReturnType<typeof vi.fn>;
  setMenu: ReturnType<typeof vi.fn>;
  setMinimumSize: ReturnType<typeof vi.fn>;
  maximize: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  isVisible: ReturnType<typeof vi.fn>;
  isFocused: ReturnType<typeof vi.fn>;
  isMinimized: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: {
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
    isLoadingMainFrame: ReturnType<typeof vi.fn>;
    on: (event: string, cb: Listener) => void;
    once: (event: string, cb: Listener) => void;
  };
}

const mocks = vi.hoisted(() => {
  const unregisterContextMenu = vi.fn();
  return {
    unregisterContextMenu,
    createTray: vi.fn(),
    emitWindowState: vi.fn(),
    schedulePersistAppWindowState: vi.fn(),
    persistAppWindowState: vi.fn(),
    scheduleReload: vi.fn(),
    applyWindowsWindowIcon: vi.fn(),
    openDevToolsWindow: vi.fn(),
    toggleDevToolsForSender: vi.fn(),
    isAutoLaunched: vi.fn(() => false),
    appQuit: vi.fn(),
    registerContextMenu: vi.fn(() => unregisterContextMenu),
    shellOpenExternal: vi.fn(),
    getDatabase: vi.fn(),
    initializeDesktopPet: vi.fn(),
    initializeCompanionWindow: vi.fn(),
    getCompanions: vi.fn(() => []),
  };
});

vi.mock('electron', () => {
  const addListener = (map: Map<string, Listener[]>, event: string, cb: Listener) => {
    const list = map.get(event) ?? [];
    list.push(cb);
    map.set(event, list);
  };
  class MockBrowserWindow {
    static instances: MockBrowserWindow[] = [];
    readonly listeners = new Map<string, Listener[]>();
    readonly webContentsListeners = new Map<string, Listener[]>();
    readonly loadFile = vi.fn();
    readonly setMenu = vi.fn();
    readonly setMinimumSize = vi.fn();
    readonly maximize = vi.fn();
    readonly show = vi.fn();
    readonly focus = vi.fn();
    readonly restore = vi.fn();
    readonly isVisible = vi.fn(() => true);
    readonly isFocused = vi.fn(() => true);
    readonly isMinimized = vi.fn(() => false);
    readonly isDestroyed = vi.fn(() => false);
    readonly webContents = {
      setWindowOpenHandler: vi.fn(),
      isLoadingMainFrame: vi.fn(() => false),
      on: (event: string, cb: Listener) => {
        addListener(this.webContentsListeners, event, cb);
      },
      once: (event: string, cb: Listener) => {
        addListener(this.webContentsListeners, event, cb);
      },
    };
    constructor(_options: unknown) {
      MockBrowserWindow.instances.push(this);
    }
    on(event: string, cb: Listener) {
      addListener(this.listeners, event, cb);
    }
    once(event: string, cb: Listener) {
      addListener(this.listeners, event, cb);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
    emitWebContents(event: string, ...args: unknown[]) {
      for (const cb of this.webContentsListeners.get(event) ?? []) cb(...args);
    }
  }
  return {
    app: { getName: () => 'ZhiYuan Agent', getVersion: () => '0.0.0', quit: mocks.appQuit },
    nativeImage: { createFromPath: () => ({}) },
    shell: { openExternal: mocks.shellOpenExternal },
    BrowserWindow: MockBrowserWindow,
  };
});

vi.mock('./appEnv', () => ({
  DEV_SERVER_URL: 'http://localhost:5175/',
  isDev: false,
  isLinuxRendererSmoke: false,
  isMac: false,
  isWindows: false,
  runtimeAppName: 'ZhiYuan Agent',
}));
vi.mock('./windowBranding', () => ({
  PRELOAD_PATH: '/preload.js',
  applyWindowsWindowIcon: mocks.applyWindowsWindowIcon,
  getAppIconPath: () => '/icon.png',
}));
vi.mock('./windowManagement', () => ({
  emitWindowState: mocks.emitWindowState,
  schedulePersistAppWindowState: mocks.schedulePersistAppWindowState,
  persistAppWindowState: mocks.persistAppWindowState,
  getTitleBarOverlayOptions: () => ({}),
  getDisplayWorkAreas: () => [],
  scheduleReload: mocks.scheduleReload,
}));
vi.mock('../appIpc', () => ({
  openDevToolsWindow: mocks.openDevToolsWindow,
  toggleDevToolsForSender: mocks.toggleDevToolsForSender,
}));
vi.mock('./appLifecycle', () => ({ logAppQuitContextOnce: vi.fn() }));
vi.mock('../autoLaunchManager', () => ({ isAutoLaunched: mocks.isAutoLaunched }));
vi.mock('./runtimeServices', () => ({
  getStore: () => ({
    get: (key: string) => (key === 'app_config' ? { language: 'zh' } : undefined),
    getDatabase: mocks.getDatabase,
  }),
}));
vi.mock('../contextMenu', () => ({ registerContextMenu: mocks.registerContextMenu }));
vi.mock('../trayManager', () => ({ createTray: mocks.createTray, updateTrayMenu: vi.fn() }));
vi.mock('../desktopPet/controller', () => ({
  initializeDesktopPet: mocks.initializeDesktopPet,
  openDesktopPetSession: vi.fn(),
  getDesktopPetWindow: vi.fn(() => null),
  setDesktopPetBubbleVisible: vi.fn(),
  observeDesktopPetCompanionActivity: vi.fn(),
  setDesktopPetAppearance: vi.fn(),
}));
vi.mock('../companion/window', () => ({
  initializeCompanionWindow: mocks.initializeCompanionWindow,
}));
vi.mock('./sessionServices', () => ({
  getPiRuntimeAdapter: () => ({ getCompanions: mocks.getCompanions }),
}));
vi.mock('./companionTasks', () => ({ getCompanionTasks: () => [] }));
vi.mock('./appConfigSettings', () => ({ getInitialTheme: () => 'light' }));

import { BrowserWindow } from 'electron';

import { createMainWindow, focusOrCreateMainWindow } from './mainWindow';
import { lifecycleRuntime } from './lifecycleRuntimeState';

const mockWindowClass = BrowserWindow as unknown as {
  instances: MockWindow[];
};

const currentWindow = (): MockWindow => {
  const window = mockWindowClass.instances.at(-1);
  if (!window) throw new Error('no mock window was created');
  return window;
};

beforeEach(() => {
  mockWindowClass.instances = [];
  lifecycleRuntime.mainWindow = null;
  lifecycleRuntime.isQuitting = false;
  lifecycleRuntime.bootstrapComplete = false;
  mocks.unregisterContextMenu.mockClear();
  vi.clearAllMocks();
});

describe('createMainWindow', () => {
  test('creates a window and loads the packaged renderer', () => {
    createMainWindow();

    expect(mockWindowClass.instances).toHaveLength(1);
    const window = currentWindow();
    expect(lifecycleRuntime.mainWindow).toBe(window);
    expect(window.loadFile).toHaveBeenCalledTimes(1);
    // loadFile receives a native path; Windows uses backslashes.
    expect(String(window.loadFile.mock.calls[0][0]).replaceAll('\\', '/')).toContain(
      'dist/index.html',
    );
    expect(window.setMinimumSize).toHaveBeenCalledWith(1024, 740);
    window.emitWebContents('did-finish-load');
  });

  test('reuses the existing window instead of creating a second one', () => {
    createMainWindow();
    const window = currentWindow();
    window.isVisible.mockImplementation(() => false);
    window.isFocused.mockImplementation(() => false);

    createMainWindow();

    expect(mockWindowClass.instances).toHaveLength(1);
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    window.emitWebContents('did-finish-load');
  });

  test('opens every external link in the system browser without an embedded auth popup', () => {
    createMainWindow();
    const window = currentWindow();
    const handler = window.webContents.setWindowOpenHandler.mock.calls[0][0] as (details: {
      url: string;
    }) => { action: string };

    const external = handler({ url: 'https://example.com/' });
    expect(external).toEqual({ action: 'deny' });
    expect(mocks.shellOpenExternal).toHaveBeenCalledWith('https://example.com/');

    const formerAuthUrl = 'https://work.weixin.qq.com/oauth';
    expect(handler({ url: formerAuthUrl })).toEqual({ action: 'deny' });
    expect(mocks.shellOpenExternal).toHaveBeenCalledWith(formerAuthUrl);
    expect(mocks.shellOpenExternal).toHaveBeenCalledTimes(2);
    expect(window.webContentsListeners.has('did-create-window')).toBe(false);
    window.emitWebContents('did-finish-load');
  });

  test('starts native window surfaces without opening or migrating old scheduled-task SQL', () => {
    createMainWindow();
    const window = currentWindow();

    window.emit('ready-to-show');

    expect(window.show).toHaveBeenCalled();
    expect(mocks.createTray).toHaveBeenCalledTimes(1);
    expect(mocks.initializeDesktopPet).toHaveBeenCalledTimes(1);
    expect(mocks.initializeCompanionWindow).toHaveBeenCalledTimes(1);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    const trayWindowProvider = mocks.createTray.mock.calls[0][0] as () => unknown;
    expect(trayWindowProvider()).toBe(window);
    window.emitWebContents('did-finish-load');
  });

  test('quits when the main window closes outside a quit', () => {
    createMainWindow();
    const window = currentWindow();

    window.emit('closed');

    expect(lifecycleRuntime.mainWindow).toBeNull();
    expect(mocks.unregisterContextMenu).toHaveBeenCalled();
    expect(mocks.appQuit).toHaveBeenCalledTimes(1);
    window.emitWebContents('did-finish-load');
  });

  test('does not quit again while a quit is already in progress', () => {
    createMainWindow();
    const window = currentWindow();
    lifecycleRuntime.isQuitting = true;

    window.emit('closed');

    expect(lifecycleRuntime.mainWindow).toBeNull();
    expect(mocks.appQuit).not.toHaveBeenCalled();
  });
});

describe('focusOrCreateMainWindow', () => {
  test('focuses an existing window without creating another', () => {
    lifecycleRuntime.bootstrapComplete = true;
    createMainWindow();
    const window = currentWindow();
    window.isVisible.mockImplementation(() => false);
    window.isFocused.mockImplementation(() => false);

    expect(focusOrCreateMainWindow()).toBe(window);
    expect(mockWindowClass.instances).toHaveLength(1);
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    window.emitWebContents('did-finish-load');
  });

  test('recreates the main window after bootstrap when it is gone', () => {
    lifecycleRuntime.bootstrapComplete = true;

    const created = focusOrCreateMainWindow();

    expect(created).toBe(currentWindow());
    expect(mockWindowClass.instances).toHaveLength(1);
    expect(lifecycleRuntime.mainWindow).toBe(currentWindow());
  });

  test('does not recreate a window while bootstrap is incomplete', () => {
    expect(focusOrCreateMainWindow()).toBeNull();
    expect(mockWindowClass.instances).toHaveLength(0);
  });

  test('does not recreate a window while quitting', () => {
    lifecycleRuntime.bootstrapComplete = true;
    lifecycleRuntime.isQuitting = true;

    expect(focusOrCreateMainWindow()).toBeNull();
    expect(mockWindowClass.instances).toHaveLength(0);
  });
});
