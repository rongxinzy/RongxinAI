import { beforeEach, afterEach, test, expect, vi } from 'vitest';

import {
  DesktopPetIpc,
  DesktopPetTaskResult,
  DESKTOP_PET_STORE_KEY,
  DESKTOP_PET_FAILURES_KEY,
} from '../../shared/desktopPet/constants';
import { PiUiEventSequencer, PiUiEventType } from '../../shared/cowork/piUiEvent';
import { CoworkErrorKind } from '../../common/coworkError';

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
    pause = mocks.pause;
    resume = mocks.resume;
    reset() {}
    ensureVisible() {}
  },
}));

import {
  initializeDesktopPet,
  disposeDesktopPet,
  setDesktopPetEnabled,
  isDesktopPetEnabled,
  observeDesktopPetEvent,
} from './controller';

let saved: unknown;
const preferences = {
  get: <T>(key: string) =>
    (key === DESKTOP_PET_STORE_KEY ? saved : mocks.values.get(key)) as T | undefined,
  set: (key: string, value: unknown) => {
    if (key === DESKTOP_PET_STORE_KEY) saved = value;
    else mocks.values.set(key, value);
  },
};
const getMainWindow = () =>
  ({
    ...mocks.main,
    isFullScreen: () => mocks.fullscreen,
    on: (event: string, listener: () => void) => mocks.mainEvents.set(event, listener),
    removeListener: (event: string) => mocks.mainEvents.delete(event),
  }) as never;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.options.length = 0;
  mocks.windows.length = 0;
  saved = undefined;
  mocks.fullscreen = false;
  mocks.values.clear();
  initializeDesktopPet(preferences, getMainWindow, mocks.changed);
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
  expect(mocks.handles.size).toBe(0);
  expect(mocks.power.size).toBe(0);
});

const invoke = (channel: string, ...args: unknown[]) =>
  mocks.handles.get(channel)!(
    {
      sender: mocks.main.webContents,
      senderFrame: mocks.main.webContents.mainFrame,
    },
    ...args,
  );

test('settings validate payload and sender, remain enabled while quiet, and synchronize visibility', async () => {
  await expect(
    mocks.handles.get(DesktopPetIpc.GetSettings)!({ sender: {}, senderFrame: {} }),
  ).rejects.toThrow('main window');
  await expect(invoke(DesktopPetIpc.SetSettings, { enabled: 'yes' })).rejects.toThrow(
    'invalid arguments',
  );
  expect(await invoke(DesktopPetIpc.GetSettings)).toEqual({
    enabled: false,
    doNotDisturb: false,
    hideInFullscreen: true,
  });
  await invoke(DesktopPetIpc.SetSettings, { enabled: true });
  mocks.windows[0].emit('ready-to-show');
  expect(mocks.show).toHaveBeenCalledOnce();
  await invoke(DesktopPetIpc.SetSettings, { doNotDisturb: true });
  expect(mocks.hide).toHaveBeenCalledOnce();
  expect(isDesktopPetEnabled()).toBe(true);
  await invoke(DesktopPetIpc.SetSettings, { doNotDisturb: false });
  expect(mocks.show).toHaveBeenCalledTimes(2);
  mocks.fullscreen = true;
  mocks.mainEvents.get('enter-full-screen')!();
  expect(mocks.hide).toHaveBeenCalledTimes(2);
  mocks.power.get('lock-screen')!();
  mocks.fullscreen = false;
  mocks.mainEvents.get('leave-full-screen')!();
  expect(mocks.show).toHaveBeenCalledTimes(2);
  mocks.power.get('unlock-screen')!();
  expect(mocks.show).toHaveBeenCalledTimes(3);
  expect(await invoke(DesktopPetIpc.GetSettings)).toEqual({
    enabled: true,
    doNotDisturb: false,
    hideInFullscreen: true,
  });
});

test('task navigation keeps failures until a matching successful acknowledgement, including across restart', async () => {
  let eventId = 0;
  const events = new PiUiEventSequencer(() => `event-${++eventId}`);
  const fail = () =>
    observeDesktopPetEvent(
      events.next({
        type: PiUiEventType.Error,
        sessionId: 'failed-task',
        error: { kind: CoworkErrorKind.Unknown, message: 'failed' },
      }),
    );
  fail();
  setDesktopPetEnabled(true);
  const contents = mocks.windows[0].webContents;
  const open = () =>
    mocks.ipc.get(DesktopPetIpc.Open)!({ sender: contents, senderFrame: contents.mainFrame });
  open();
  const first = (await invoke(DesktopPetIpc.GetPendingTask)) as {
    requestId: number;
    sessionId: string;
  };
  expect(first.sessionId).toBe('failed-task');
  expect(mocks.main.webContents.send).toHaveBeenCalledWith(DesktopPetIpc.OpenTask, first);
  expect(mocks.values.get(DESKTOP_PET_FAILURES_KEY)).toHaveLength(1);
  vi.advanceTimersByTime(60_000);
  await invoke(DesktopPetIpc.ResolveTask, first.requestId, DesktopPetTaskResult.Failed);
  expect(mocks.values.get(DESKTOP_PET_FAILURES_KEY)).toHaveLength(1);
  open();
  const second = (await invoke(DesktopPetIpc.GetPendingTask)) as { requestId: number };
  fail();
  await invoke(DesktopPetIpc.ResolveTask, second.requestId, DesktopPetTaskResult.Opened);
  expect(mocks.values.get(DESKTOP_PET_FAILURES_KEY)).toHaveLength(1);
  open();
  const last = (await invoke(DesktopPetIpc.GetPendingTask)) as { requestId: number };
  await invoke(DesktopPetIpc.ResolveTask, last.requestId, DesktopPetTaskResult.Opened);
  expect(mocks.values.get(DESKTOP_PET_FAILURES_KEY)).toEqual([]);
  fail();
  disposeDesktopPet();
  initializeDesktopPet(preferences, getMainWindow, mocks.changed);
  const restored = mocks.windows.at(-1)!.webContents;
  mocks.ipc.get(DesktopPetIpc.Ready)!({ sender: restored, senderFrame: restored.mainFrame });
  expect(restored.send).toHaveBeenLastCalledWith(
    DesktopPetIpc.State,
    expect.objectContaining({ state: 'error' }),
  );
});

test('reminder storage failure cannot throw into the task event pipeline', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const original = preferences.set;
  const writing = vi.spyOn(preferences, 'set').mockImplementation((key, value) => {
    if (key === DESKTOP_PET_FAILURES_KEY) throw new Error('fixture storage unavailable');
    original(key, value);
  });
  try {
    const events = new PiUiEventSequencer(() => 'storage-failure');
    expect(() =>
      observeDesktopPetEvent(
        events.next({
          type: PiUiEventType.Error,
          sessionId: 'a',
          error: { kind: CoworkErrorKind.Unknown, message: 'failed' },
        }),
      ),
    ).not.toThrow();
    expect(warning).toHaveBeenCalledOnce();
  } finally {
    writing.mockRestore();
    warning.mockRestore();
  }
});
