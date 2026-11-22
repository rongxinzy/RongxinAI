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
import type { CompanionActivity } from './chat';
import type { CompanionConversation } from '../../shared/companion/types';

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
  isCompanionWindowVisible,
  openCompanionWindow,
  prepareCompanionWindow,
} from './window';

function fixture(open = true) {
  const profile = {
    petId: '00000000-0000-4000-8000-000000000001',
    personaId: DesktopPetBuiltinId.Xiaoyuan,
    characterId: DesktopPetBuiltinId.Xiaoyuan,
    createdAt: 1,
  };
  const chat = {
    availability: vi.fn(async () => ({
      capability: 'local',
      modelId: null,
      imageInput: false,
      toolUse: false,
    })),
    history: vi.fn((): CompanionConversation => ({ messages: [], pending: null })),
    submit: vi.fn(),
    stop: vi.fn(),
    onActivity: vi.fn((_listener: (activity: CompanionActivity) => void) => vi.fn()),
  };
  const main = new FakeWindow({});
  let profileChanged: (() => void) | undefined;
  const unsubscribeProfile = vi.fn(() => {
    profileChanged = undefined;
  });
  const profiles = {
    active: () => profile,
    onChanged: (listener: () => void) => {
      profileChanged = listener;
      return unsubscribeProfile;
    },
    snapshot: () => ({ activePetId: profile.petId, profiles: [profile] }),
    visibleSnapshot: () => ({ activePetId: profile.petId, profiles: [profile] }),
    select: vi.fn((petId: string) => {
      profile.petId = petId;
      profileChanged?.();
      return profile;
    }),
    changeAppearance: vi.fn((_petId: string, characterId: DesktopPetBuiltinId) => {
      profile.characterId = characterId;
      profileChanged?.();
      return profile;
    }),
  };
  const onVisibilityChanged = vi.fn(() => isCompanionWindowVisible());
  const tasks = {
    snapshot: vi.fn((petId: string) => ({ petId, revision: 1, tasks: [] })),
    workspaces: vi.fn(() => []),
    owned: vi.fn(() => false),
    onChanged: vi.fn((_listener: (sessionId: string) => void) => vi.fn()),
    submit: vi.fn(),
    stop: vi.fn(),
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
  initializeCompanionWindow({
    store: { get: () => undefined, onDidChange: () => () => {} },
    getMainWindow: () => main,
    getCompanions: () => ({ profiles, chat }) as never,
    onVisibilityChanged,
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
    chat,
    profile,
    profiles,
    event,
    invoke,
    unsubscribeProfile,
    onVisibilityChanged,
    tasks,
    openTask,
  };
}

afterEach(async () => {
  await disposeCompanionWindow();
  mocks.windows.length = 0;
  vi.clearAllMocks();
});

test('publishes the task revision only to the bubble', () => {
  const f = fixture();
  f.tasks.owned.mockReturnValue(true);
  f.tasks.snapshot.mockClear();
  f.tasks.onChanged.mock.calls[0][0]('session');

  expect(f.tasks.snapshot).toHaveBeenCalledExactlyOnceWith(f.profile.petId);
  const snapshot = f.tasks.snapshot.mock.results[0].value;
  expect(f.window.webContents.send).toHaveBeenCalledWith(IpcChannel.TasksChanged, snapshot);
  expect(f.main.webContents.send).not.toHaveBeenCalled();
});

test('disposal waits for an admitted attachment write and rejects the queued request', async () => {
  const f = fixture();
  const staged = Promise.withResolvers<{
    id: string;
    name: string;
    bytes: number;
  }>();
  f.tasks.attachments.stage.mockReturnValue(staged.promise);
  const file = { name: 'pasted.txt', mimeType: 'text/plain', data: new Uint8Array([1]) };
  const writing = f.invoke(IpcChannel.StageFile, f.profile.petId, file);
  await vi.waitFor(() => expect(f.tasks.attachments.stage).toHaveBeenCalledOnce());
  const queued = expect(f.invoke(IpcChannel.StageFile, f.profile.petId, file)).rejects.toThrow(
    'owned main frame',
  );
  const onDrained = vi.fn();
  const drained = disposeCompanionWindow()?.then(onDrained);
  expect(drained).toBeDefined();
  expect(mocks.handlers.has(IpcChannel.StageFile)).toBe(false);
  await Promise.resolve();
  expect(onDrained).not.toHaveBeenCalled();

  staged.resolve({ id: '00000000-0000-4000-8000-000000000009', name: file.name, bytes: 1 });
  await writing;
  await queued;
  await drained;
  expect(f.tasks.attachments.stage).toHaveBeenCalledOnce();
  expect(onDrained).toHaveBeenCalledOnce();
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
  expect(f.chat.submit).not.toHaveBeenCalled();
  expect(mocks.register).toHaveBeenCalledWith(COMPANION_SHORTCUT, expect.any(Function));
});

test('activity projection subscribes once without loading the hidden conversation and unsubscribes on disposal', () => {
  const f = fixture(false);
  prepareCompanionWindow();
  expect(f.chat.onActivity).toHaveBeenCalledExactlyOnceWith(expect.any(Function));
  expect(f.chat.availability).not.toHaveBeenCalled();
  expect(f.chat.history).not.toHaveBeenCalled();
  const unsubscribe = f.chat.onActivity.mock.results[0].value;
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
  expect(f.chat.availability).not.toHaveBeenCalled();
  expect(f.chat.history).not.toHaveBeenCalled();
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
  expect(f.chat.submit).not.toHaveBeenCalled();
});

test('hide and close preserve the conversation, while stop is explicit', async () => {
  const f = fixture();
  await f.invoke(IpcChannel.Hide);
  const preventDefault = vi.fn();
  f.window.emit('close', { preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(f.window.hide).toHaveBeenCalledTimes(2);
  expect(f.chat.stop).not.toHaveBeenCalled();
  await f.invoke(IpcChannel.Stop, f.profile.petId);
  expect(f.chat.stop).toHaveBeenCalledWith(f.profile);
});

test('hiding a loading bubble cancels its pending first show', async () => {
  const f = fixture();
  await f.invoke(IpcChannel.Hide);
  f.window.emit('ready-to-show');
  expect(f.window.show).not.toHaveBeenCalled();
  expect(f.window.focus).not.toHaveBeenCalled();
});

test('visibility observers read the same transitions as preload, including window destruction', async () => {
  const f = fixture();
  f.window.emit('ready-to-show');
  f.window.emit('show');
  expect(await f.invoke(IpcChannel.GetVisibility)).toBe(true);
  await f.invoke(IpcChannel.Hide);
  f.window.emit('hide');
  expect(await f.invoke(IpcChannel.GetVisibility)).toBe(false);
  openCompanionWindow();
  f.window.destroy();
  expect(isCompanionWindowVisible()).toBe(false);
  expect(f.onVisibilityChanged.mock.results.map(result => result.value)).toEqual([
    true,
    false,
    true,
    false,
  ]);
  expect(
    f.window.webContents.send.mock.calls.filter(([channel]) => channel === IpcChannel.Visibility),
  ).toEqual([
    [IpcChannel.Visibility, true],
    [IpcChannel.Visibility, false],
    [IpcChannel.Visibility, true],
  ]);
});

test('only the bubble bootstrap consumes the pending composer mode', async () => {
  const f = fixture(false);
  const mainSnapshot = mocks.handlers.get(IpcChannel.Bootstrap)!({
    sender: f.main.webContents,
    senderFrame: f.main.webContents.mainFrame,
  });
  await expect(mainSnapshot).rejects.toThrow('owned main frame');
  expect(f.chat.availability).not.toHaveBeenCalled();
  openCompanionWindow(CompanionComposerMode.Task);
  await expect(f.invoke(IpcChannel.Bootstrap)).resolves.toMatchObject({
    context: { mode: CompanionComposerMode.Task },
  });
  const nextBubbleContext = ((await f.invoke(IpcChannel.Bootstrap)) as { context: object }).context;
  expect(nextBubbleContext).not.toHaveProperty('mode');
});

test('the bridge exposes profile state and the workbench without general application IPC', async () => {
  const f = fixture();
  expect(await f.invoke(IpcChannel.Bootstrap)).toMatchObject({
    activePetId: f.profile.petId,
    conversation: { messages: [] },
  });
  await f.invoke(IpcChannel.Select, f.profile.petId);
  expect(f.main.webContents.send).not.toHaveBeenCalled();
  await f.invoke(IpcChannel.OpenWorkbench);
  expect(f.main.focus).toHaveBeenCalledOnce();
  expect(mocks.handlers.size).toBe(13);
  disposeCompanionWindow();
  expect(f.unsubscribeProfile).toHaveBeenCalledOnce();
  expect(mocks.handlers.size).toBe(0);
  expect(mocks.unregister).toHaveBeenCalledWith(COMPANION_SHORTCUT);
});

test('initialization does not resolve the companion model before opening the bubble', () => {
  const f = fixture(false);
  expect(f.chat.availability).not.toHaveBeenCalled();
});

test('chat activity refreshes the bubble through the same conversation snapshot', async () => {
  const f = fixture();
  const receipt = { petId: f.profile.petId, requestId: 'same-request', submissionId: 1 };
  f.chat.history.mockReturnValue({
    pending: null,
    messages: [{ id: 2, role: 'assistant', text: 'Done' }],
    lastReply: { ...receipt, state: CompanionRequestState.Answered },
  });
  f.main.webContents.send.mockClear();
  f.window.webContents.send.mockClear();
  const [activity] = f.chat.onActivity.mock.calls[0];
  activity({ ...receipt, state: CompanionRequestState.Accepted });
  expect(f.main.webContents.send).not.toHaveBeenCalled();
  expect(f.window.webContents.send).toHaveBeenCalledExactlyOnceWith(IpcChannel.Changed);
  f.main.webContents.send.mockClear();
  f.window.webContents.send.mockClear();
  activity({ ...receipt, state: CompanionRequestState.Answered });
  await expect(f.invoke(IpcChannel.Bootstrap)).resolves.toMatchObject({
    conversation: { messages: [{ text: 'Done' }], pending: null },
  });
  expect(f.main.webContents.send).not.toHaveBeenCalled();
  expect(f.window.webContents.send).toHaveBeenCalledExactlyOnceWith(IpcChannel.Changed);
});

test('submitting the same chat receipt again does not refresh the bubble', async () => {
  const f = fixture();
  const request = { petId: f.profile.petId, requestId: 'same-submit', text: 'Hi' };
  const receipt = { petId: request.petId, requestId: request.requestId, submissionId: 1 };
  const result = {
    receipt,
    availability: {
      capability: 'chat',
      modelId: 'fixture/chat',
      imageInput: false,
      toolUse: false,
    },
  };
  const [activity] = f.chat.onActivity.mock.calls[0];
  f.chat.submit
    .mockImplementationOnce(async () => {
      activity({ ...receipt, state: CompanionRequestState.Accepted });
      return result;
    })
    .mockResolvedValue(result);
  f.main.webContents.send.mockClear();
  f.window.webContents.send.mockClear();

  await expect(f.invoke(IpcChannel.Submit, request)).resolves.toEqual(result);
  await expect(f.invoke(IpcChannel.Submit, request)).resolves.toEqual(result);
  expect(f.main.webContents.send).not.toHaveBeenCalled();
  expect(f.window.webContents.send).toHaveBeenCalledExactlyOnceWith(IpcChannel.Changed);
});

test('reply refreshes follow the new profile before its model availability resolves', async () => {
  const f = fixture();
  const [activity] = f.chat.onActivity.mock.calls[0];
  const first = { petId: f.profile.petId, submissionId: 1 };
  const second = { petId: '00000000-0000-4000-8000-000000000099', submissionId: 2 };
  const availability = Promise.withResolvers<Awaited<ReturnType<typeof f.chat.availability>>>();
  f.chat.availability.mockReturnValueOnce(availability.promise);
  const switched = f.invoke(IpcChannel.Select, second.petId);
  await vi.waitFor(() => expect(f.profiles.select).toHaveBeenCalledWith(second.petId));

  f.window.webContents.send.mockClear();
  activity({ ...first, state: CompanionRequestState.Answered });
  expect(f.window.webContents.send).not.toHaveBeenCalled();
  activity({ ...second, state: CompanionRequestState.Answered });
  expect(f.window.webContents.send).toHaveBeenCalledExactlyOnceWith(IpcChannel.Changed);
  availability.resolve({ capability: 'local', modelId: null, imageInput: false, toolUse: false });
  await switched;
  expect(f.chat.stop).not.toHaveBeenCalled();
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

test('rejects the main window and delivers workbench navigation to it', async () => {
  const f = fixture();
  const mainEvent = { sender: f.main.webContents, senderFrame: f.main.webContents.mainFrame };
  await expect(mocks.handlers.get(IpcChannel.Bootstrap)!(mainEvent)).rejects.toThrow(
    'owned main frame',
  );
  await expect(
    mocks.handlers.get(IpcChannel.Bootstrap)!({ ...mainEvent, senderFrame: {} }),
  ).rejects.toThrow('owned main frame');
  await expect(mocks.handlers.get(IpcChannel.Hide)!(mainEvent)).rejects.toThrow('owned main frame');
  expect(f.main.hide).not.toHaveBeenCalled();
  await f.invoke(IpcChannel.Select, f.profile.petId);
  expect(f.main.webContents.send).not.toHaveBeenCalled();
  expect(f.window.webContents.send).toHaveBeenCalledWith(IpcChannel.Changed);
  await f.invoke(IpcChannel.OpenWorkbench);
  expect(f.main.webContents.send).toHaveBeenCalledWith(IpcChannel.Workbench);
});

test('a stale or queued companion request cannot submit or stop a different companion', async () => {
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
  expect(f.chat.submit).not.toHaveBeenCalled();
  expect(f.chat.stop).not.toHaveBeenCalled();
});

test('stop commands bypass a loading snapshot and use the active companion', async () => {
  const f = fixture();
  const loading = Promise.withResolvers<void>();
  f.chat.availability.mockImplementationOnce(async () => {
    await loading.promise;
    return f.chat.availability();
  });
  const snapshot = f.invoke(IpcChannel.Bootstrap);
  await Promise.resolve();
  expect(f.chat.availability).toHaveBeenCalledOnce();
  const stop = f.invoke(IpcChannel.Stop, f.profile.petId);
  const sessionId = '00000000-0000-4000-8000-000000000022';
  const stopTask = f.invoke(IpcChannel.StopTask, sessionId);
  try {
    expect(f.chat.stop).toHaveBeenCalledExactlyOnceWith(f.profile);
    expect(f.tasks.stop).toHaveBeenCalledExactlyOnceWith(f.profile.petId, sessionId);
  } finally {
    loading.resolve();
    await Promise.all([snapshot, stop, stopTask]);
  }
});

test('appearance changes notify the bubble without changing personality or starting a request', () => {
  const f = fixture();
  f.profiles.changeAppearance(f.profile.petId, DesktopPetBuiltinId.Youli);
  expect(f.profile.personaId).toBe(DesktopPetBuiltinId.Xiaoyuan);
  expect(f.main.webContents.send).not.toHaveBeenCalled();
  expect(f.window.webContents.send).toHaveBeenCalledWith(IpcChannel.Changed);
  expect(f.chat.submit).not.toHaveBeenCalled();
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
