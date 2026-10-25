import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { Menu } from 'electron';

import { setLanguage } from '../i18n';

import {
  DesktopPetIpc,
  DesktopPetPlayableAction,
  DESKTOP_PET_STORE_KEY,
} from '../../shared/desktopPet/constants';
import { PiUiEventSequencer, PiUiEventType } from '../../shared/cowork/piUiEvent';

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
    setRoamingEnabled() {}
    setAllowRoam() {}
    pause = mocks.pause;
    resume = mocks.resume;
    reset() {}
    rest() {}
    ensureVisible() {}
  },
}));

import {
  initializeDesktopPet,
  disposeDesktopPet,
  setDesktopPetEnabled,
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
  setLanguage('zh');
  vi.useRealTimers();
});

const invoke = (channel: string, ...args: unknown[]) =>
  mocks.handles.get(channel)!(
    { sender: mocks.main.webContents, senderFrame: mocks.main.webContents.mainFrame },
    ...args,
  );

test('the menu offers on-demand actions that reach the pet window as effects', () => {
  setDesktopPetEnabled(true);
  const contents = mocks.windows[0].webContents;
  mocks.ipc.get(DesktopPetIpc.Menu)!({ sender: contents, senderFrame: contents.mainFrame });
  const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)![0] as Array<{
    label?: string;
    click?: () => void;
  }>;
  const byLabel = (label: string) => template.find(item => item.label === label);
  contents.send.mockClear();
  byLabel('侧看一眼')!.click!();
  byLabel('点点头')!.click!();
  byLabel('舒展一下')!.click!();
  const actions = contents.send.mock.calls
    .filter(([channel]) => channel === DesktopPetIpc.Effect)
    .map(([, effect]) => (effect as { action: string }).action);
  expect(actions).toEqual([
    DesktopPetPlayableAction.Peek,
    DesktopPetPlayableAction.Nod,
    DesktopPetPlayableAction.Flutter,
  ]);
});

test('menu actions emit matching localized chatter and task bubbles take precedence', async () => {
  await invoke(DesktopPetIpc.SetSettings, { enabled: true });
  mocks.windows[0].emit('ready-to-show');
  const contents = mocks.windows[0].webContents;
  mocks.ipc.get(DesktopPetIpc.Menu)!({ sender: contents, senderFrame: contents.mainFrame });
  const template = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)![0] as Array<{
    label?: string;
    click?: () => void;
  }>;
  const byLabel = (label: string) => template.find(item => item.label === label)!;
  contents.send.mockClear();
  for (const [label, bubble] of [
    ['侧看一眼', '我看一眼～'],
    ['点点头', '嗯嗯'],
    ['舒展一下', '伸个懒腰。'],
  ]) {
    byLabel(label).click!();
    expect(contents.send).toHaveBeenLastCalledWith(
      DesktopPetIpc.State,
      expect.objectContaining({ bubble }),
    );
  }
  observeDesktopPetEvent(
    new PiUiEventSequencer(() => 'action-chatter-task').next({
      type: PiUiEventType.Started,
      sessionId: 'action-chatter-task',
    }),
  );
  expect(contents.send).toHaveBeenLastCalledWith(
    DesktopPetIpc.State,
    expect.objectContaining({ state: 'thinking', bubble: '处理中' }),
  );
  byLabel('点点头').click!();
  expect(contents.send).toHaveBeenLastCalledWith(
    DesktopPetIpc.State,
    expect.objectContaining({ state: 'thinking', bubble: '处理中' }),
  );
});
