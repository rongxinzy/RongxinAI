import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ipc: new Map<string, (event: unknown, payload?: unknown) => void>(),
  handles: new Map<string, (event: unknown, ...payload: unknown[]) => Promise<unknown>>(),
  power: new Map<string, () => void>(),
  mainEvents: new Map<string, () => void>(),
  values: new Map<string, unknown>(),
  fullscreen: false,
  main: {
    webContents: { mainFrame: {}, send: vi.fn(), isDestroyed: () => false },
    isDestroyed: () => false,
    isMinimized: () => false,
    show: vi.fn(),
    focus: vi.fn(),
  },
  hide: vi.fn(),
  show: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  options: [] as Record<string, unknown>[],
  windows: [] as Array<{
    webContents: { mainFrame: object; send: ReturnType<typeof vi.fn> };
    emit: (event: string) => void;
    loadURL: ReturnType<typeof vi.fn>;
  }>,
  begin: vi.fn(),
  end: vi.fn(() => false),
  dispose: vi.fn(),
  setMask: vi.fn(),
  screenOn: vi.fn(),
  screenOff: vi.fn(),
  changed: vi.fn(),
  openChat: vi.fn(),
  hideChat: vi.fn(),
  menuPopup: vi.fn(),
  rest: vi.fn(),
  allowRoam: vi.fn(),
}));

export { mocks };

vi.mock('electron', () => {
  class Window {
    readonly id = 7;
    readonly webContents = {
      mainFrame: {},
      send: vi.fn(),
      isDestroyed: () => false,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };
    readonly loadURL = vi.fn(() => Promise.resolve());
    private readonly callbacks = new Map<string, () => void>();
    constructor(options: Record<string, unknown>) {
      mocks.options.push(options);
      mocks.windows.push(this);
    }
    once(event: string, callback: () => void) {
      this.callbacks.set(event, callback);
    }
    emit(event: string) {
      this.callbacks.get(event)?.();
    }
    close() {
      this.emit('closed');
    }
    destroy() {
      this.emit('closed');
    }
    isDestroyed() {
      return false;
    }
    getPosition() {
      return [300, 400];
    }
    showInactive = mocks.show;
    hide = mocks.hide;
    setVisibleOnAllWorkspaces() {}
  }
  const display = { workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  return {
    app: { isPackaged: false, getAppPath: () => '/application' },
    BrowserWindow: Window,
    powerMonitor: {
      getSystemIdleState: () => 'active',
      on: (event: string, listener: () => void) => mocks.power.set(event, listener),
      removeListener: (event: string) => mocks.power.delete(event),
    },
    ipcMain: {
      handle: (
        channel: string,
        handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
      ) => mocks.handles.set(channel, handler),
      removeHandler: (channel: string) => mocks.handles.delete(channel),
      on: (channel: string, callback: (event: unknown, payload?: unknown) => void) =>
        mocks.ipc.set(channel, callback),
      removeListener: (channel: string) => mocks.ipc.delete(channel),
    },
    screen: {
      getPrimaryDisplay: () => display,
      getDisplayNearestPoint: () => display,
      on: mocks.screenOn,
      removeListener: mocks.screenOff,
    },
    Menu: { buildFromTemplate: vi.fn(() => ({ popup: mocks.menuPopup })) },
  };
});

vi.mock('../../src/main/desktopPet/motion', () => ({
  petBounds: () => ({ minX: 0, minY: 0, maxX: 1248, maxY: 708 }),
  clampPetPosition: (point: unknown) => point,
  DesktopPetMotion: class {
    begin = mocks.begin;
    end = mocks.end;
    dispose = mocks.dispose;
    setMask = mocks.setMask;
    setReducedMotion() {}
    setRoamingEnabled() {}
    setWindowSnapshot() {}
    setAllowRoam = mocks.allowRoam;
    pause = mocks.pause;
    resume = mocks.resume;
    reset() {}
    rest = mocks.rest;
    ensureVisible() {}
  },
}));

vi.mock('../../src/main/companion/window', () => ({
  openCompanionWindow: mocks.openChat,
  hideCompanionWindow: mocks.hideChat,
  prepareCompanionWindow: vi.fn(),
  updateActiveCompanionAppearance: vi.fn(),
}));
