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
  const cronStartPolling = vi.fn();
  return {
    unregisterContextMenu,
    cronStartPolling,
    createTray: vi.fn(),
    emitWindowState: vi.fn(),
    schedulePersistAppWindowState: vi.fn(),
    persistAppWindowState: vi.fn(),
    scheduleReload: vi.fn(),
    applyWindowsWindowIcon: vi.fn(),
    openDevToolsWindow: vi.fn(),
    toggleDevToolsForSender: vi.fn(),
    isAutoLaunched: vi.fn(() => false),
    registerContextMenu: vi.fn(() => unregisterContextMenu),
    getCronJobService: vi.fn(() => ({ startPolling: cronStartPolling })),
    shellOpenExternal: vi.fn(),
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
    app: { getName: () => 'ZhiYuan Agent', getVersion: () => '0.0.0' },
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
vi.mock('./appIpc', () => ({
  openDevToolsWindow: mocks.openDevToolsWindow,
  toggleDevToolsForSender: mocks.toggleDevToolsForSender,
}));
vi.mock('./windowSecurity', () => ({
  isWecomAuthUrl: (url: string) => url.startsWith('https://wecom.example/'),
}));
vi.mock('./appLifecycle', () => ({ logAppQuitContextOnce: vi.fn() }));
vi.mock('../ipcHandlers/scheduledTask', () => ({
  getCronJobService: mocks.getCronJobService,
}));
vi.mock('../autoLaunchManager', () => ({ isAutoLaunched: mocks.isAutoLaunched }));
vi.mock('./runtimeServices', () => ({
  getStore: () => ({
    get: (key: string) => (key === 'app_config' ? { language: 'zh' } : undefined),
    getDatabase: () => ({}),
  }),
}));
vi.mock('../contextMenu', () => ({ registerContextMenu: mocks.registerContextMenu }));
vi.mock('../trayManager', () => ({ createTray: mocks.createTray }));
vi.mock('./appConfigSettings', () => ({ getInitialTheme: () => 'light' }));
vi.mock('../../scheduledTask/migrate', () => ({
  migrateLegacyScheduledTasksToCanonical: vi.fn(() => Promise.resolve()),
  migrateLegacyScheduledTaskRunsToCanonical: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../scheduledTask/sqliteScheduledTaskStore', () => ({
  SqliteScheduledTaskStore: vi.fn(),
}));

import { BrowserWindow } from 'electron';

import { createMainWindow } from './mainWindow';
import { rt } from './runtimeState';

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
  rt.mainWindow = null;
  mocks.unregisterContextMenu.mockClear();
  mocks.cronStartPolling.mockClear();
  vi.clearAllMocks();
});

describe('createMainWindow', () => {
  test('creates a window and loads the packaged renderer', () => {
    createMainWindow();

    expect(mockWindowClass.instances).toHaveLength(1);
    const window = currentWindow();
    expect(rt.mainWindow).toBe(window);
    expect(window.loadFile).toHaveBeenCalledTimes(1);
    expect(window.loadFile.mock.calls[0][0]).toContain('dist/index.html');
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

  test('routes window.open through the Wecom-only security policy', () => {
    createMainWindow();
    const window = currentWindow();
    const handler = window.webContents.setWindowOpenHandler.mock.calls[0][0] as (details: {
      url: string;
    }) => { action: string };

    const external = handler({ url: 'https://example.com/' });
    expect(external).toEqual({ action: 'deny' });
    expect(mocks.shellOpenExternal).toHaveBeenCalledWith('https://example.com/');

    const wecom = handler({ url: 'https://wecom.example/oauth' });
    expect(wecom.action).toBe('allow');
    expect(mocks.shellOpenExternal).toHaveBeenCalledTimes(1);
    window.emitWebContents('did-finish-load');
  });

  test('creates the tray and starts cron polling once the window is ready', () => {
    createMainWindow();
    const window = currentWindow();

    window.emit('ready-to-show');

    expect(window.show).toHaveBeenCalled();
    expect(mocks.createTray).toHaveBeenCalledTimes(1);
    const trayWindowProvider = mocks.createTray.mock.calls[0][0] as () => unknown;
    expect(trayWindowProvider()).toBe(window);
    expect(mocks.cronStartPolling).toHaveBeenCalled();
    window.emitWebContents('did-finish-load');
  });

  test('drops the window reference and context menu when the window closes', () => {
    createMainWindow();
    const window = currentWindow();

    window.emit('closed');

    expect(rt.mainWindow).toBeNull();
    expect(mocks.unregisterContextMenu).toHaveBeenCalled();
    window.emitWebContents('did-finish-load');
  });
});
