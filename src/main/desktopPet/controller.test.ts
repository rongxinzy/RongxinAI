import { mocks } from '../../../tests/fixtures/desktopPetController';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { petMenuItem } from '../../../tests/fixtures/desktopPetMenu';

import { setLanguage } from '../i18n';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';

import {
  DesktopPetEffectKind,
  DesktopPetIpc,
  DesktopPetPlayableAction,
  DesktopPetTaskResult,
  DESKTOP_PET_CLICK_DELAY_MS,
  DESKTOP_PET_STORE_KEY,
  DESKTOP_PET_FAILURES_KEY,
} from '../../shared/desktopPet/constants';
import { CompanionComposerMode } from '../../shared/companion/constants';
import { PiUiEventSequencer, PiUiEventType } from '../../shared/cowork/piUiEvent';
import { CoworkErrorKind } from '../../common/coworkError';

import {
  initializeDesktopPet,
  disposeDesktopPet,
  setDesktopPetEnabled,
  setDesktopPetBubbleVisible,
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
  setLanguage('zh');
  vi.useRealTimers();
});

test('the companion is opt-in and uses a dedicated sandboxed preload', () => {
  expect(isDesktopPetEnabled()).toBe(false);
  setDesktopPetEnabled(true);
  expect(mocks.options[0]).toMatchObject({
    transparent: true,
    frame: false,
    alwaysOnTop: false,
    focusable: false,
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
  expect(saved).toEqual({ enabled: true, layoutVersion: 1, x: 300, y: 400 });
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
  expect(Object.keys(snapshot).sort()).toEqual([
    'bubble',
    'characterId',
    'label',
    'reducedMotion',
    'state',
  ]);
});

test('the menu offers on-demand actions that reach the pet window as effects', () => {
  setDesktopPetEnabled(true);
  const contents = mocks.windows[0].webContents;
  const byLabel = petMenuItem(mocks.ipc.get(DesktopPetIpc.Menu)!, contents);
  contents.send.mockClear();
  byLabel('侧看一眼')!.click!();
  byLabel('点点头')!.click!();
  byLabel('展翅一下')!.click!();
  const actions = contents.send.mock.calls
    .filter(([channel]) => channel === DesktopPetIpc.Effect)
    .map(([, effect]) => (effect as { action: string }).action);
  expect(actions).toEqual([
    DesktopPetPlayableAction.Peek,
    DesktopPetPlayableAction.Nod,
    DesktopPetPlayableAction.Flutter,
  ]);
});

test('a single click gives varied visual feedback and chatter after debounce without opening chat or the workbench', () => {
  setDesktopPetEnabled(true);
  mocks.windows[0].emit('ready-to-show');
  const contents = mocks.windows[0].webContents;
  const sender = { sender: contents, senderFrame: contents.mainFrame };
  const expected = [
    [DesktopPetPlayableAction.Happy, '嘿嘿！'],
    [DesktopPetPlayableAction.Peek, '我看一眼～'],
    [DesktopPetPlayableAction.Nod, '嗯嗯'],
    [DesktopPetPlayableAction.Flutter, '扑棱一下'],
  ] as const;
  for (const [action, bubble] of expected) {
    contents.send.mockClear();
    mocks.end.mockReturnValueOnce(true);
    mocks.ipc.get(DesktopPetIpc.DragEnd)!(sender);
    expect(contents.send).not.toHaveBeenCalledWith(
      DesktopPetIpc.Effect,
      expect.objectContaining({ kind: DesktopPetEffectKind.Action }),
    );
    vi.advanceTimersByTime(DESKTOP_PET_CLICK_DELAY_MS);
    expect(contents.send).toHaveBeenCalledWith(DesktopPetIpc.Effect, {
      kind: DesktopPetEffectKind.Action,
      action,
    });
    expect(contents.send).toHaveBeenLastCalledWith(
      DesktopPetIpc.State,
      expect.objectContaining({ bubble }),
    );
  }
  expect(mocks.openChat).not.toHaveBeenCalled();
  expect(mocks.main.show).not.toHaveBeenCalled();
  expect(contents.send).not.toHaveBeenCalledWith(
    DesktopPetIpc.State,
    expect.objectContaining({ state: 'greeting' }),
  );
});

test('double click cancels pending single-click feedback and toggles chat while the right menu retains task navigation', () => {
  setDesktopPetEnabled(true);
  mocks.windows[0].emit('ready-to-show');
  const contents = mocks.windows[0].webContents;
  const sender = { sender: contents, senderFrame: contents.mainFrame };
  contents.send.mockClear();
  mocks.end.mockReturnValueOnce(true);
  mocks.ipc.get(DesktopPetIpc.DragEnd)!(sender);
  mocks.ipc.get(DesktopPetIpc.Open)!(sender);
  vi.advanceTimersByTime(DESKTOP_PET_CLICK_DELAY_MS * 2);
  expect(contents.send).not.toHaveBeenCalledWith(
    DesktopPetIpc.Effect,
    expect.objectContaining({ kind: DesktopPetEffectKind.Action }),
  );
  expect(mocks.openChat).toHaveBeenCalledOnce();
  expect(mocks.hideChat).not.toHaveBeenCalled();
  setDesktopPetBubbleVisible(true);
  mocks.ipc.get(DesktopPetIpc.Open)!(sender);
  expect(mocks.hideChat).toHaveBeenCalledOnce();
  expect(mocks.main.show).not.toHaveBeenCalled();
  petMenuItem(mocks.ipc.get(DesktopPetIpc.Menu)!, contents)('打开知远智能体').click!();
  expect(mocks.main.show).toHaveBeenCalledOnce();
});

test('right-click menu provides mode-specific companion entry, interact submenu, and live preference toggles', async () => {
  await invoke(DesktopPetIpc.SetSettings, { enabled: true });
  mocks.windows[0].emit('ready-to-show');
  const contents = mocks.windows[0].webContents;
  const openMenu = () => {
    const lastPopup = mocks.menuPopup.mock.calls.at(-1)?.[0] as
      | { callback?: () => void }
      | undefined;
    lastPopup?.callback?.();
    return petMenuItem(mocks.ipc.get(DesktopPetIpc.Menu)!, contents);
  };

  openMenu()('聊两句').click!();
  expect(mocks.openChat).toHaveBeenLastCalledWith(CompanionComposerMode.Chat);

  setDesktopPetBubbleVisible(true);
  openMenu()('收起对话').click!();
  expect(mocks.hideChat).toHaveBeenCalledOnce();
  setDesktopPetBubbleVisible(false);

  openMenu()('交代任务').click!();
  expect(mocks.openChat).toHaveBeenLastCalledWith(CompanionComposerMode.Task);

  const interact = openMenu()('互动一下');
  expect(interact.submenu?.map(item => item.label)).toEqual([
    '打个招呼',
    '侧看一眼',
    '点点头',
    '展翅一下',
  ]);

  const roaming = openMenu()('屏幕漫游');
  expect(roaming).toMatchObject({ type: 'checkbox', checked: true });
  roaming.click!();
  expect(await invoke(DesktopPetIpc.GetSettings)).toMatchObject({ roaming: false });
  expect(mocks.main.webContents.send).toHaveBeenLastCalledWith(
    DesktopPetIpc.SettingsChanged,
    expect.objectContaining({ roaming: false }),
  );

  const chatter = openMenu()('偶尔碎碎念');
  expect(chatter).toMatchObject({ type: 'checkbox', checked: true });
  chatter.click!();
  expect(await invoke(DesktopPetIpc.GetSettings)).toMatchObject({ chatter: false });
  expect(mocks.main.webContents.send).toHaveBeenLastCalledWith(
    DesktopPetIpc.SettingsChanged,
    expect.objectContaining({ chatter: false }),
  );
});

test('the native context menu pauses movement and restores only a visible pet', async () => {
  await invoke(DesktopPetIpc.SetSettings, { enabled: true });
  mocks.windows[0].emit('ready-to-show');
  mocks.pause.mockClear();
  mocks.resume.mockClear();
  const contents = mocks.windows[0].webContents;
  petMenuItem(mocks.ipc.get(DesktopPetIpc.Menu)!, contents);
  expect(mocks.pause).toHaveBeenCalledOnce();
  expect(mocks.rest).toHaveBeenCalled();
  const close = (mocks.menuPopup.mock.calls.at(-1)![0] as { callback: () => void }).callback;
  close();
  expect(mocks.resume).toHaveBeenCalledOnce();
  petMenuItem(mocks.ipc.get(DesktopPetIpc.Menu)!, contents)('收起小远').click!();
  close();
  expect(mocks.resume).toHaveBeenCalledOnce();
});

test('cancelled pointer releases cannot trigger a chat, task, or click performance', () => {
  setDesktopPetEnabled(true);
  const contents = mocks.windows[0].webContents;
  contents.send.mockClear();
  mocks.ipc.get(DesktopPetIpc.DragEnd)!(
    { sender: contents, senderFrame: contents.mainFrame },
    true,
  );
  expect(mocks.end).toHaveBeenCalledWith(true);
  expect(mocks.openChat).not.toHaveBeenCalled();
  expect(contents.send).not.toHaveBeenCalled();
});

test('menu actions emit matching localized chatter and task bubbles take precedence', async () => {
  await invoke(DesktopPetIpc.SetSettings, { enabled: true });
  mocks.windows[0].emit('ready-to-show');
  const contents = mocks.windows[0].webContents;
  const byLabel = petMenuItem(mocks.ipc.get(DesktopPetIpc.Menu)!, contents);
  contents.send.mockClear();
  for (const [label, bubble] of [
    ['侧看一眼', '我看一眼～'],
    ['点点头', '嗯嗯'],
    ['展翅一下', '扑棱一下'],
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

test('English action chatter is localized and expires after the show window', async () => {
  setLanguage('en');
  await invoke(DesktopPetIpc.SetSettings, { enabled: true });
  mocks.windows[0].emit('ready-to-show');
  const contents = mocks.windows[0].webContents;
  const byLabel = petMenuItem(mocks.ipc.get(DesktopPetIpc.Menu)!, contents);
  byLabel('Peek sideways').click!();
  expect(contents.send).toHaveBeenLastCalledWith(
    DesktopPetIpc.State,
    expect.objectContaining({ bubble: 'Just a peek~' }),
  );
  vi.advanceTimersByTime(4_000);
  expect(contents.send).toHaveBeenLastCalledWith(
    DesktopPetIpc.State,
    expect.objectContaining({ bubble: null }),
  );
});

test('single click action chatter expires after the show window and does not open chat', () => {
  setDesktopPetEnabled(true);
  mocks.windows[0].emit('ready-to-show');
  const contents = mocks.windows[0].webContents;
  mocks.end.mockReturnValueOnce(true);
  mocks.ipc.get(DesktopPetIpc.DragEnd)!({ sender: contents, senderFrame: contents.mainFrame });
  vi.advanceTimersByTime(DESKTOP_PET_CLICK_DELAY_MS);
  expect(contents.send).toHaveBeenCalledWith(DesktopPetIpc.Effect, {
    kind: DesktopPetEffectKind.Action,
    action: DesktopPetPlayableAction.Happy,
  });
  expect(contents.send).toHaveBeenLastCalledWith(
    DesktopPetIpc.State,
    expect.objectContaining({ bubble: '嘿嘿！' }),
  );
  vi.advanceTimersByTime(4_000);
  expect(contents.send).toHaveBeenLastCalledWith(
    DesktopPetIpc.State,
    expect.objectContaining({ bubble: null }),
  );
  expect(mocks.openChat).not.toHaveBeenCalled();
});

test('action chatter respects settings, visibility, and reduced motion', async () => {
  await invoke(DesktopPetIpc.SetSettings, { enabled: true });
  mocks.windows[0].emit('ready-to-show');
  const contents = mocks.windows[0].webContents;
  const menu = () => petMenuItem(mocks.ipc.get(DesktopPetIpc.Menu)!, contents)('点点头').click!();
  const happy = () => {
    mocks.end.mockReturnValueOnce(true);
    mocks.ipc.get(DesktopPetIpc.DragEnd)!({ sender: contents, senderFrame: contents.mainFrame });
    vi.advanceTimersByTime(DESKTOP_PET_CLICK_DELAY_MS);
  };
  const lastBubble = () =>
    (
      contents.send.mock.calls
        .filter(([channel]) => channel === DesktopPetIpc.State)
        .at(-1)![1] as {
        bubble: string | null;
      }
    ).bubble;

  await invoke(DesktopPetIpc.SetSettings, { chatter: false });
  menu();
  happy();
  expect(lastBubble()).toBeNull();
  await invoke(DesktopPetIpc.SetSettings, { chatter: true });
  menu();
  await invoke(DesktopPetIpc.SetSettings, { chatter: false });
  expect(lastBubble()).toBeNull();

  await invoke(DesktopPetIpc.SetSettings, { chatter: true, doNotDisturb: true });
  happy();
  expect(lastBubble()).toBeNull();
  await invoke(DesktopPetIpc.SetSettings, { doNotDisturb: false });
  mocks.ipc.get(DesktopPetIpc.Motion)!({ sender: contents, senderFrame: contents.mainFrame }, true);
  menu();
  happy();
  expect(lastBubble()).toBeNull();
});

test('hiding preserves position and disposal removes IPC and screen listeners', () => {
  setDesktopPetEnabled(true);
  setDesktopPetEnabled(false);
  expect(preferences.get(DESKTOP_PET_STORE_KEY)).toEqual({
    enabled: false,
    layoutVersion: 1,
    x: 300,
    y: 400,
  });
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
    characterId: DesktopPetBuiltinId.Xiaoyuan,
    enabled: false,
    doNotDisturb: false,
    hideInFullscreen: true,
    roaming: true,
    chatter: true,
  });
  await invoke(DesktopPetIpc.SetSettings, { enabled: true });
  mocks.windows[0].emit('ready-to-show');
  expect(mocks.show).toHaveBeenCalledOnce();
  await invoke(DesktopPetIpc.SetSettings, { doNotDisturb: true });
  expect(mocks.hide).toHaveBeenCalledOnce();
  expect(mocks.windows[0].webContents.send).toHaveBeenCalledWith(DesktopPetIpc.Effect, {
    kind: DesktopPetEffectKind.Visibility,
    visible: false,
  });
  expect(isDesktopPetEnabled()).toBe(true);
  await invoke(DesktopPetIpc.SetSettings, { doNotDisturb: false });
  expect(mocks.show).toHaveBeenCalledTimes(2);
  expect(mocks.windows[0].webContents.send).toHaveBeenCalledWith(DesktopPetIpc.Effect, {
    kind: DesktopPetEffectKind.Visibility,
    visible: true,
  });
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
    characterId: DesktopPetBuiltinId.Xiaoyuan,
    enabled: true,
    doNotDisturb: false,
    hideInFullscreen: true,
    roaming: true,
    chatter: true,
  });
});

test('released character settings restore saved pets and preserve failures across appearance changes', async () => {
  saved = { characterId: DesktopPetBuiltinId.Youli, enabled: false };
  expect(await invoke(DesktopPetIpc.GetSettings)).toMatchObject({
    characterId: DesktopPetBuiltinId.Youli,
  });
  expect(saved).toEqual({ characterId: DesktopPetBuiltinId.Youli, enabled: false });
  await expect(invoke(DesktopPetIpc.SetSettings, { characterId: '../unknown' })).rejects.toThrow(
    'invalid arguments',
  );
  await invoke(DesktopPetIpc.SetSettings, {
    enabled: true,
    characterId: DesktopPetBuiltinId.Youli,
  });
  await invoke(DesktopPetIpc.SetSettings, { enabled: true });
  const events = new PiUiEventSequencer(() => 'character-failure');
  observeDesktopPetEvent(
    events.next({
      type: PiUiEventType.Error,
      sessionId: 'failed',
      error: { kind: CoworkErrorKind.Unknown, message: 'failed' },
    }),
  );
  await invoke(DesktopPetIpc.SetSettings, { characterId: DesktopPetBuiltinId.Yunmo });
  expect(mocks.values.get(DESKTOP_PET_FAILURES_KEY)).toHaveLength(1);
  disposeDesktopPet();
  initializeDesktopPet(preferences, getMainWindow, mocks.changed);
  expect(await invoke(DesktopPetIpc.GetSettings)).toMatchObject({
    characterId: DesktopPetBuiltinId.Yunmo,
  });
  const contents = mocks.windows.at(-1)!.webContents;
  mocks.ipc.get(DesktopPetIpc.Ready)!({ sender: contents, senderFrame: contents.mainFrame });
  expect(contents.send).toHaveBeenLastCalledWith(
    DesktopPetIpc.State,
    expect.objectContaining({ characterId: DesktopPetBuiltinId.Yunmo, state: 'error' }),
  );
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
    petMenuItem(mocks.ipc.get(DesktopPetIpc.Menu)!, contents)('查看待处理任务').click!();
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
