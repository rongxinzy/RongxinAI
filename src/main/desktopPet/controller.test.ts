import { beforeEach, afterEach, test, expect, vi } from 'vitest';

import { DesktopPetIpc, DESKTOP_PET_STORE_KEY } from '../../shared/desktopPet/constants';

const mocks = vi.hoisted(() => ({
  ipc: new Map<string, (event: unknown, payload?: unknown) => void>(),
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
}));

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
    showInactive() {}
    setVisibleOnAllWorkspaces() {}
  }
  const display = { workArea: { x: 0, y: 0, width: 1440, height: 900 } };
  return {
    app: { isPackaged: false, getAppPath: () => '/application' },
    BrowserWindow: Window,
    ipcMain: {
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
    Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  };
});

vi.mock('./motion', () => ({
  petBounds: () => ({ minX: 0, minY: 0, maxX: 1248, maxY: 708 }),
  clampPetPosition: (point: unknown) => point,
  DesktopPetMotion: class {
    begin = mocks.begin;
    end = mocks.end;
    dispose = mocks.dispose;
    setMask = mocks.setMask;
    setReducedMotion() {}
    reset() {}
    ensureVisible() {}
  },
}));

import {
  initializeDesktopPet,
  disposeDesktopPet,
  setDesktopPetEnabled,
  isDesktopPetEnabled,
} from './controller';

let saved: unknown;
const preferences = {
  get: <T>(_key: string) => saved as T | undefined,
  set: (_key: string, value: unknown) => {
    saved = value;
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.options.length = 0;
  mocks.windows.length = 0;
  saved = undefined;
  initializeDesktopPet(preferences, () => null, mocks.changed);
});
afterEach(() => {
  disposeDesktopPet();
  vi.useRealTimers();
});

test('the companion is opt-in and uses a dedicated sandboxed preload', () => {
  expect(isDesktopPetEnabled()).toBe(false);
  setDesktopPetEnabled(true);
  expect(mocks.options[0]).toMatchObject({
    transparent: true,
    frame: false,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: '/application/dist-electron/desktopPetPreload.js',
    },
  });
  expect(mocks.windows[0].loadURL).toHaveBeenCalledWith(
    expect.stringContaining('desktop-pet.html'),
  );
  expect(saved).toEqual({ enabled: true, x: 300, y: 400 });
});

test('IPC rejects other windows and subframes and bounds the alpha mask', () => {
  setDesktopPetEnabled(true);
  const contents = mocks.windows[0].webContents;
  const start = mocks.ipc.get(DesktopPetIpc.DragStart)!;
  start({ sender: {}, senderFrame: contents.mainFrame });
  start({ sender: contents, senderFrame: {} });
  expect(mocks.begin).not.toHaveBeenCalled();
  const sender = { sender: contents, senderFrame: contents.mainFrame };
  start(sender);
  expect(mocks.begin).toHaveBeenCalledOnce();
  const mask = mocks.ipc.get(DesktopPetIpc.HitMask)!;
  mask(sender, new Uint8Array(1_000_000));
  mask(sender, 'invalid');
  expect(mocks.setMask).not.toHaveBeenCalled();
  mask(sender, new Uint8Array(192 * 192));
  expect(mocks.setMask).toHaveBeenCalledOnce();
});

test('the renderer receives only a localized status snapshot', () => {
  setDesktopPetEnabled(true);
  const contents = mocks.windows[0].webContents;
  mocks.ipc.get(DesktopPetIpc.Ready)!({ sender: contents, senderFrame: contents.mainFrame });
  const [channel, snapshot] = contents.send.mock.calls.at(-1)!;
  expect(channel).toBe(DesktopPetIpc.State);
  expect(Object.keys(snapshot).sort()).toEqual(['label', 'reducedMotion', 'state']);
});

test('hiding preserves position and disposal removes IPC and screen listeners', () => {
  setDesktopPetEnabled(true);
  setDesktopPetEnabled(false);
  expect(preferences.get(DESKTOP_PET_STORE_KEY)).toEqual({ enabled: false, x: 300, y: 400 });
  expect(isDesktopPetEnabled()).toBe(false);
  expect(mocks.dispose).toHaveBeenCalled();
  disposeDesktopPet();
  expect(mocks.ipc.size).toBe(0);
  expect(mocks.screenOff).toHaveBeenCalledWith('display-removed', expect.any(Function));
});
