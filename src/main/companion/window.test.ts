import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';
import { CompanionIpc as IpcChannel } from '../../shared/ipc/channels';
import { COMPANION_SHORTCUT } from '../../shared/companion/constants';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  register: vi.fn(() => true),
  unregister: vi.fn(),
  windows: [] as FakeWindow[],
}));

class FakeWindow extends EventEmitter {
  id = 1;
  destroyed = false;
  webContents = {
    mainFrame: {},
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
  };
  show = vi.fn();
  hide = vi.fn();
  focus = vi.fn();
  restore = vi.fn();
  loadURL = vi.fn(async () => {});
  loadFile = vi.fn(async () => {});
  setTitle = vi.fn();
  constructor(readonly options: Record<string, unknown>) {
    super();
    mocks.windows.push(this);
  }
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return false;
  }
  destroy() {
    this.destroyed = true;
    this.emit('closed');
  }
}

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app' },
  BrowserWindow: vi.fn(function (options: Record<string, unknown>) {
    return new FakeWindow(options);
  }),
  globalShortcut: { register: mocks.register, unregister: mocks.unregister },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
  screen: {
    getCursorScreenPoint: () => ({ x: -500, y: 50 }),
    getDisplayNearestPoint: () => ({ workArea: { x: -1440, y: 0, width: 1440, height: 900 } }),
  },
}));

import {
  disposeCompanionWindow,
  initializeCompanionWindow,
  isCompanionWindow,
  openCompanionWindow,
} from './window';

function fixture() {
  const profile = {
    petId: '00000000-0000-4000-8000-000000000001',
    personaId: DesktopPetBuiltinId.Xiaoyuan,
    characterId: DesktopPetBuiltinId.Xiaoyuan,
    createdAt: 1,
  };
  const runtime = {
    resume: vi.fn(async () => ({
      capability: 'local',
      modelId: null,
      imageInput: false,
      toolUse: false,
    })),
    history: vi.fn(async () => ({ messages: [], pending: null })),
    submit: vi.fn(),
    answer: vi.fn(),
    stop: vi.fn(async () => {}),
    close: vi.fn(),
  };
  const main = new FakeWindow({});
  const profiles = {
    active: () => profile,
    snapshot: () => ({ activePetId: profile.petId, profiles: [profile] }),
    select: vi.fn(() => profile),
  };
  const onProfileChanged = vi.fn();
  const tasks = {
    recent: vi.fn(() => []),
    workspaces: vi.fn(() => []),
    owned: vi.fn(() => false),
    onChanged: vi.fn(() => vi.fn()),
    submit: vi.fn(),
  };
  const openTask = vi.fn();
  initializeCompanionWindow({
    store: { get: () => undefined, onDidChange: () => () => {} },
    getMainWindow: () => main,
    getCompanions: () => ({ profiles, runtime }) as never,
    onProfileChanged,
    getTasks: () => tasks as never,
    openTask,
  });
  openCompanionWindow();
  const window = mocks.windows.at(-1)!;
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const invoke = (channel: string, ...args: unknown[]) =>
    mocks.handlers.get(channel)!(event, ...args);
  return {
    window,
    main,
    runtime,
    profile,
    profiles,
    event,
    invoke,
    onProfileChanged,
    tasks,
    openTask,
  };
}

afterEach(() => {
  disposeCompanionWindow();
  mocks.windows.length = 0;
  vi.clearAllMocks();
});

test('creates a focusable sandboxed window and reuses it without admitting a model request', () => {
  const f = fixture();
  expect(f.window.options).toMatchObject({
    minWidth: 448,
    focusable: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  expect(f.window.loadURL).toHaveBeenCalledWith(expect.stringContaining('/companion.html'));
  expect(isCompanionWindow(f.window as never)).toBe(true);
  openCompanionWindow();
  expect(mocks.windows).toHaveLength(2);
  expect(f.window.focus).toHaveBeenCalledOnce();
  expect(f.runtime.submit).not.toHaveBeenCalled();
  expect(mocks.register).toHaveBeenCalledWith(COMPANION_SHORTCUT, expect.any(Function));
});

test('rejects foreign senders, subframes and malformed input before runtime execution', async () => {
  const f = fixture();
  const submit = mocks.handlers.get(IpcChannel.Submit)!;
  const request = { requestId: 'one', text: 'hello' };
  await expect(submit({ sender: {}, senderFrame: {} }, request)).rejects.toThrow(
    'owned main frame',
  );
  await expect(submit({ ...f.event, senderFrame: {} }, request)).rejects.toThrow(
    'owned main frame',
  );
  await expect(f.invoke(IpcChannel.Submit, { ...request, cwd: '/private' })).rejects.toThrow(
    'invalid arguments',
  );
  expect(f.runtime.submit).not.toHaveBeenCalled();
});

test('hide and close preserve the conversation, while stop is explicit', async () => {
  const f = fixture();
  await f.invoke(IpcChannel.Hide);
  const preventDefault = vi.fn();
  f.window.emit('close', { preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(f.window.hide).toHaveBeenCalledTimes(2);
  expect(f.runtime.stop).not.toHaveBeenCalled();
  expect(f.runtime.close).not.toHaveBeenCalled();
  await f.invoke(IpcChannel.Stop);
  expect(f.runtime.stop).toHaveBeenCalledWith(f.profile);
});

test('the bridge exposes profile state and the workbench without general application IPC', async () => {
  const f = fixture();
  expect(await f.invoke(IpcChannel.Bootstrap)).toMatchObject({
    activePetId: f.profile.petId,
    conversation: { messages: [] },
  });
  await f.invoke(IpcChannel.Select, f.profile.petId);
  expect(f.onProfileChanged).toHaveBeenCalledWith(f.profile);
  await f.invoke(IpcChannel.OpenWorkbench);
  expect(f.main.focus).toHaveBeenCalledOnce();
  expect(mocks.handlers.size).toBe(10);
  disposeCompanionWindow();
  expect(mocks.handlers.size).toBe(0);
  expect(mocks.unregister).toHaveBeenCalledWith(COMPANION_SHORTCUT);
});

test('task navigation checks active companion ownership and does not run the task again', async () => {
  const f = fixture();
  const sessionId = '00000000-0000-4000-8000-000000000002';
  await expect(f.invoke(IpcChannel.OpenWorkbench, sessionId)).rejects.toThrow('another companion');
  expect(f.openTask).not.toHaveBeenCalled();
  f.tasks.owned.mockReturnValue(true);
  await f.invoke(IpcChannel.OpenWorkbench, sessionId);
  expect(f.openTask).toHaveBeenCalledWith(sessionId);
  expect(f.tasks.submit).not.toHaveBeenCalled();
});
