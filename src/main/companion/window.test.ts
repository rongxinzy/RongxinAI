import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { CompanionIpc as IpcChannel } from '../../shared/ipc/channels';
import {
  COMPANION_SHORTCUT,
  CompanionComposerMode,
  CompanionRequestState,
} from '../../shared/companion/constants';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { MemoryKind } from '../../shared/memory/constants';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  register: vi.fn(() => true),
  unregister: vi.fn(),
  choose: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  windows: [] as FakeWindow[],
}));

class FakeWindow extends EventEmitter {
  id = 1;
  destroyed = false;
  webContents = {
    mainFrame: {},
    isDestroyed: () => false,
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
  getBounds = vi.fn(() => ({ x: 0, y: 0, width: 480, height: 400 }));
  setBounds = vi.fn();
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
  app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/owned-temp' },
  BrowserWindow: vi.fn(function (options: Record<string, unknown>) {
    return new FakeWindow(options);
  }),
  globalShortcut: { register: mocks.register, unregister: mocks.unregister },
  dialog: { showOpenDialog: mocks.choose },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(channel, handler),
    removeHandler: (channel: string) => mocks.handlers.delete(channel),
  },
  screen: {
    on: vi.fn(),
    removeListener: vi.fn(),
    getCursorScreenPoint: () => ({ x: -500, y: 50 }),
    getDisplayNearestPoint: () => ({ workArea: { x: -1440, y: 0, width: 1440, height: 900 } }),
  },
}));

import {
  disposeCompanionWindow,
  initializeCompanionWindow,
  isCompanionWindow,
  openCompanionWindow,
  prepareCompanionWindow,
  updateActiveCompanionAppearance,
} from './window';

function fixture(open = true) {
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
    onActivity: vi.fn(() => vi.fn()),
  };
  const main = new FakeWindow({});
  const profiles = {
    active: () => profile,
    snapshot: () => ({ activePetId: profile.petId, profiles: [profile] }),
    visibleSnapshot: () => ({ activePetId: profile.petId, profiles: [profile] }),
    select: vi.fn(() => profile),
    changeAppearance: vi.fn(),
  };
  const onProfileChanged = vi.fn();
  const onActivity = vi.fn();
  const tasks = {
    snapshot: vi.fn((petId: string) => ({ petId, revision: 1, tasks: [] })),
    workspaces: vi.fn(() => []),
    owned: vi.fn(() => false),
    onChanged: vi.fn(() => vi.fn()),
    submit: vi.fn(),
    chooseWorkspace: vi.fn(async () => ({ id: 'workspace', name: 'Chosen folder' })),
    attachments: {
      stage: vi.fn(async () => ({
        id: '00000000-0000-4000-8000-000000000009',
        name: 'pasted.txt',
        bytes: 5,
      })),
      choose: vi.fn(async () => [
        {
          id: '00000000-0000-4000-8000-000000000009',
          name: 'report.pdf',
          bytes: 20,
        },
      ]),
    },
  };
  const openTask = vi.fn();
  const memory = {
    list: vi.fn(() => []),
    save: vi.fn(),
    confirm: vi.fn(),
    forget: vi.fn(async () => true),
    shareConfirmed: vi.fn(async () => ({ id: 'shared', available: true })),
  };
  initializeCompanionWindow({
    store: { get: () => undefined, onDidChange: () => () => {} },
    getMainWindow: () => main,
    getCompanions: () => ({ profiles, runtime, memory }) as never,
    onProfileChanged,
    onActivity,
    getTasks: () => tasks as never,
    openTask,
  });
  if (open) openCompanionWindow();
  else prepareCompanionWindow();
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
    onActivity,
    tasks,
    openTask,
    memory,
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
    alwaysOnTop: false,
    focusable: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  expect(f.window.loadURL).toHaveBeenCalledWith(expect.stringContaining('/companion.html'));
  expect(isCompanionWindow(f.window as never)).toBe(true);
  openCompanionWindow();
  expect(mocks.windows).toHaveLength(2);
  expect(f.window.focus).not.toHaveBeenCalled();
  f.window.emit('ready-to-show');
  expect(f.window.focus).toHaveBeenCalledOnce();
  expect(f.runtime.submit).not.toHaveBeenCalled();
  expect(mocks.register).toHaveBeenCalledWith(COMPANION_SHORTCUT, expect.any(Function));
});

test('activity projection subscribes once without loading the hidden conversation and unsubscribes on disposal', () => {
  const f = fixture(false);
  prepareCompanionWindow();
  expect(f.runtime.onActivity).toHaveBeenCalledExactlyOnceWith(f.onActivity);
  expect(f.runtime.resume).not.toHaveBeenCalled();
  expect(f.runtime.history).not.toHaveBeenCalled();
  const unsubscribe = f.runtime.onActivity.mock.results[0].value;
  disposeCompanionWindow();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test('preparing stays hidden without a runtime resume, and opening reuses that ready shell', async () => {
  const f = fixture(false);
  prepareCompanionWindow();
  f.window.emit('ready-to-show');
  expect(mocks.windows).toHaveLength(2);
  expect(f.window.show).not.toHaveBeenCalled();
  expect(f.window.focus).not.toHaveBeenCalled();
  f.window.emit('focus');
  expect(f.window.webContents.send).not.toHaveBeenCalledWith(IpcChannel.Focus);
  expect(await f.invoke(IpcChannel.GetVisibility)).toBe(false);
  expect(f.runtime.resume).not.toHaveBeenCalled();
  expect(f.runtime.history).not.toHaveBeenCalled();
  openCompanionWindow(CompanionComposerMode.Task);
  expect(f.window.show).toHaveBeenCalledOnce();
  expect(f.window.focus).toHaveBeenCalledOnce();
  expect(f.window.webContents.send).toHaveBeenCalledWith(
    IpcChannel.Context,
    expect.objectContaining({ mode: CompanionComposerMode.Task }),
  );
  expect(await f.invoke(IpcChannel.GetVisibility)).toBe(true);
  f.window.emit('focus');
  expect(f.window.webContents.send).toHaveBeenCalledWith(IpcChannel.Focus);
  await expect(f.invoke(IpcChannel.GetVisibility, true)).rejects.toThrow('invalid arguments');
  await expect(
    mocks.handlers.get(IpcChannel.GetVisibility)!({ sender: {}, senderFrame: {} }),
  ).rejects.toThrow('owned main frame');
});

test('rejects foreign senders, subframes and malformed input before runtime execution', async () => {
  const f = fixture();
  const submit = mocks.handlers.get(IpcChannel.Submit)!;
  const request = { petId: f.profile.petId, requestId: 'one', text: 'hello' };
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
  await f.invoke(IpcChannel.Stop, f.profile.petId);
  expect(f.runtime.stop).toHaveBeenCalledWith(f.profile);
});

test('hiding a loading bubble cancels its pending first show', async () => {
  const f = fixture();
  await f.invoke(IpcChannel.Hide);
  f.window.emit('ready-to-show');
  expect(f.window.show).not.toHaveBeenCalled();
  expect(f.window.focus).not.toHaveBeenCalled();
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
  expect(mocks.handlers.size).toBe(19);
  disposeCompanionWindow();
  expect(mocks.handlers.size).toBe(0);
  expect(mocks.unregister).toHaveBeenCalledWith(COMPANION_SHORTCUT);
});

test('memory IPC admits only owned frames and the active companion with explicit sharing confirmation', async () => {
  const f = fixture();
  const petId = f.profile.petId;
  await expect(
    mocks.handlers.get(IpcChannel.ListMemories)!({ sender: {}, senderFrame: {} }, petId),
  ).rejects.toThrow('owned main frame');
  await expect(
    f.invoke(IpcChannel.ListMemories, '00000000-0000-4000-8000-000000000099'),
  ).rejects.toThrow('selection changed');
  expect(f.memory.list).not.toHaveBeenCalled();
  expect(await f.invoke(IpcChannel.ListMemories, petId)).toEqual([]);
  const request = { petId, id: 'memory', requestId: 'share' };
  await expect(f.invoke(IpcChannel.ShareMemory, request)).rejects.toThrow('invalid arguments');
  await expect(f.invoke(IpcChannel.ShareMemory, { ...request, confirmed: false })).rejects.toThrow(
    'invalid arguments',
  );
  expect(f.memory.shareConfirmed).not.toHaveBeenCalled();
  expect(await f.invoke(IpcChannel.ShareMemory, { ...request, confirmed: true })).toEqual({
    id: 'shared',
    available: true,
  });
  expect(f.memory.shareConfirmed).toHaveBeenCalledWith(petId, 'memory', 'share');
  await f.invoke(IpcChannel.ForgetMemory, petId, 'memory');
  expect(f.memory.forget).toHaveBeenCalledWith(petId, 'memory');
});

test('memory review admits only an explicitly confirmed snapshot for the still-active owner', async () => {
  const f = fixture();
  const request = {
    petId: f.profile.petId,
    id: 'candidate',
    title: 'Decision',
    content: 'Reviewed facts.',
    kind: MemoryKind.Decision,
    confirmed: true,
  };
  const handler = mocks.handlers.get(IpcChannel.ConfirmMemory)!;
  await expect(handler({ sender: {}, senderFrame: {} }, request)).rejects.toThrow(
    'owned main frame',
  );
  await expect(handler({ ...f.event, senderFrame: {} }, request)).rejects.toThrow(
    'owned main frame',
  );
  await expect(
    f.invoke(IpcChannel.ConfirmMemory, { ...request, confirmed: false }),
  ).rejects.toThrow('invalid arguments');
  expect(f.memory.confirm).not.toHaveBeenCalled();
  f.memory.confirm.mockRejectedValueOnce(new Error('Fixture delivery'));
  await expect(f.invoke(IpcChannel.ConfirmMemory, request)).rejects.toThrow('Fixture delivery');
  expect(f.memory.confirm).toHaveBeenCalledWith(request);
  f.memory.confirm.mockClear();
  const queued = f.invoke(IpcChannel.ConfirmMemory, request);
  f.profile.petId = '00000000-0000-4000-8000-000000000099';
  await expect(queued).rejects.toThrow('selection changed');
  expect(f.memory.confirm).not.toHaveBeenCalled();
});

test('both surfaces can read a terminal reply without broadcasting it repeatedly', async () => {
  const f = fixture();
  const receipt = { petId: f.profile.petId, requestId: 'same-request', submissionId: 1 };
  f.runtime.answer.mockResolvedValue({
    ...receipt,
    state: CompanionRequestState.Answered,
    text: 'Done',
  });
  f.main.webContents.send.mockClear();
  f.window.webContents.send.mockClear();
  await f.invoke(IpcChannel.Answer, receipt);
  await mocks.handlers.get(IpcChannel.Answer)!(
    { sender: f.main.webContents, senderFrame: f.main.webContents.mainFrame },
    receipt,
  );
  await f.invoke(IpcChannel.Answer, receipt);
  expect(f.main.webContents.send).toHaveBeenCalledExactlyOnceWith(IpcChannel.Changed);
  expect(f.window.webContents.send).toHaveBeenCalledExactlyOnceWith(IpcChannel.Changed);
  f.runtime.answer.mockResolvedValue({
    ...receipt,
    submissionId: 2,
    state: CompanionRequestState.Unanswered,
    text: '',
  });
  await f.invoke(IpcChannel.Answer, { ...receipt, submissionId: 2 });
  expect(f.main.webContents.send).toHaveBeenCalledTimes(2);
});

test('workspace picking accepts paths only from its native dialog and cancellation is inert', async () => {
  const f = fixture();
  await expect(
    mocks.handlers.get(IpcChannel.ChooseWorkspace)!({ sender: {}, senderFrame: {} }),
  ).rejects.toThrow('owned main frame');
  expect(mocks.choose).not.toHaveBeenCalled();
  expect(await f.invoke(IpcChannel.ChooseWorkspace)).toBeNull();
  expect(f.tasks.chooseWorkspace).not.toHaveBeenCalled();
  mocks.choose.mockResolvedValueOnce({ canceled: false, filePaths: ['/chosen/folder'] });
  expect(await f.invoke(IpcChannel.ChooseWorkspace)).toEqual({
    id: 'workspace',
    name: 'Chosen folder',
  });
  expect(f.tasks.chooseWorkspace).toHaveBeenCalledWith('/chosen/folder');
  await expect(f.invoke(IpcChannel.ChooseWorkspace, '/renderer/path')).rejects.toThrow(
    'invalid arguments',
  );
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

test('admits only the registered app main frame and keeps quick-window hide scoped', async () => {
  const f = fixture();
  const mainEvent = { sender: f.main.webContents, senderFrame: f.main.webContents.mainFrame };
  expect(await mocks.handlers.get(IpcChannel.Bootstrap)!(mainEvent)).toMatchObject({
    activePetId: f.profile.petId,
  });
  await expect(
    mocks.handlers.get(IpcChannel.Bootstrap)!({ ...mainEvent, senderFrame: {} }),
  ).rejects.toThrow('owned main frame');
  await expect(mocks.handlers.get(IpcChannel.Hide)!(mainEvent)).rejects.toThrow('quick window');
  expect(f.main.hide).not.toHaveBeenCalled();
  await f.invoke(IpcChannel.Select, f.profile.petId);
  expect(f.main.webContents.send).toHaveBeenCalledWith(IpcChannel.Changed);
  expect(f.window.webContents.send).toHaveBeenCalledWith(IpcChannel.Changed);
  await f.invoke(IpcChannel.OpenWorkbench);
  expect(f.main.webContents.send).toHaveBeenCalledWith(IpcChannel.Workbench);
});

test('a stale or queued cross-window request cannot submit or stop a different companion', async () => {
  const f = fixture();
  const oldId = f.profile.petId;
  const submit = f.invoke(IpcChannel.Submit, {
    petId: oldId,
    requestId: 'before-switch',
    text: 'Private input',
  });
  f.profile.petId = '00000000-0000-4000-8000-000000000099';
  await expect(submit).rejects.toThrow('selection changed');
  await expect(f.invoke(IpcChannel.Stop, oldId)).rejects.toThrow('selection changed');
  expect(f.runtime.submit).not.toHaveBeenCalled();
  expect(f.runtime.stop).not.toHaveBeenCalled();
});

test('appearance changes notify both surfaces without changing personality or starting a request', () => {
  const f = fixture();
  updateActiveCompanionAppearance(DesktopPetBuiltinId.Youli);
  expect(f.profiles.changeAppearance).toHaveBeenCalledWith(
    f.profile.petId,
    DesktopPetBuiltinId.Youli,
  );
  expect(f.profile.personaId).toBe(DesktopPetBuiltinId.Xiaoyuan);
  expect(f.main.webContents.send).toHaveBeenCalledWith(IpcChannel.Changed);
  expect(f.window.webContents.send).toHaveBeenCalledWith(IpcChannel.Changed);
  expect(f.runtime.submit).not.toHaveBeenCalled();
  f.profiles.changeAppearance.mockClear();
  updateActiveCompanionAppearance(f.profile.characterId);
  expect(f.profiles.changeAppearance).not.toHaveBeenCalled();
});

test('file picking admits only native paths for the still-active owned profile', async () => {
  const f = fixture();
  await expect(
    mocks.handlers.get(IpcChannel.ChooseFiles)!({ sender: {}, senderFrame: {} }, f.profile.petId),
  ).rejects.toThrow('owned main frame');
  expect(await f.invoke(IpcChannel.ChooseFiles, f.profile.petId)).toEqual([]);
  expect(f.tasks.attachments.choose).not.toHaveBeenCalled();
  mocks.choose.mockResolvedValueOnce({ canceled: false, filePaths: ['/chosen/report.pdf'] });
  expect(await f.invoke(IpcChannel.ChooseFiles, f.profile.petId)).toEqual([
    { id: '00000000-0000-4000-8000-000000000009', name: 'report.pdf', bytes: 20 },
  ]);
  expect(f.tasks.attachments.choose).toHaveBeenCalledWith(f.profile.petId, ['/chosen/report.pdf']);
  await expect(
    f.invoke(IpcChannel.ChooseFiles, f.profile.petId, ['/renderer/path']),
  ).rejects.toThrow('invalid arguments');
  f.tasks.attachments.choose.mockClear();
  const oldId = f.profile.petId;
  mocks.choose.mockImplementationOnce(async () => {
    f.profile.petId = '00000000-0000-4000-8000-000000000099';
    return { canceled: false, filePaths: ['/chosen/report.pdf'] };
  });
  await expect(f.invoke(IpcChannel.ChooseFiles, oldId)).rejects.toThrow('selection changed');
  expect(f.tasks.attachments.choose).not.toHaveBeenCalled();
});

test('binary staging rejects foreign frames, paths, oversized bytes and stale owners', async () => {
  const f = fixture();
  const file = { name: 'pasted.txt', mimeType: 'text/plain', data: new Uint8Array([1, 2, 3]) };
  await expect(
    mocks.handlers.get(IpcChannel.StageFile)!(
      { sender: {}, senderFrame: {} },
      f.profile.petId,
      file,
    ),
  ).rejects.toThrow('owned main frame');
  await expect(
    f.invoke(IpcChannel.StageFile, f.profile.petId, { ...file, path: '/private/file' }),
  ).rejects.toThrow('invalid arguments');
  await expect(
    f.invoke(IpcChannel.StageFile, f.profile.petId, {
      ...file,
      data: new Uint8Array(25 * 1024 * 1024 + 1),
    }),
  ).rejects.toThrow('invalid arguments');
  const oldId = f.profile.petId;
  f.profile.petId = '00000000-0000-4000-8000-000000000099';
  await expect(f.invoke(IpcChannel.StageFile, oldId, file)).rejects.toThrow('selection changed');
  expect(f.tasks.attachments.stage).not.toHaveBeenCalled();
  expect(await f.invoke(IpcChannel.StageFile, f.profile.petId, file)).toMatchObject({
    name: 'pasted.txt',
  });
  expect(f.tasks.attachments.stage).toHaveBeenCalledWith(
    f.profile.petId,
    file,
    path.join('/owned-temp', 'zhiyuan', 'attachments', 'companion'),
  );
});
