import path from 'node:path';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } from 'electron';
import {
  COMPANION_PAGE,
  COMPANION_SHORTCUT,
  CompanionComposerMode,
} from '../../shared/companion/constants';
import { companionContract } from '../../shared/companion/contract';
import { CompanionIpc as IpcChannel } from '../../shared/ipc/channels';
import type {
  CompanionProfile,
  CompanionWindowContext,
  CompanionWindowState,
} from '../../shared/companion/types';
import { handleIpcContract } from '../ipc/handleIpcContract';
import type { SqliteStore } from '../sqliteStore';
import { t } from '../i18n';
import type { CompanionProfiles } from './profiles';
import type { CompanionChat } from './chat';
import type { CompanionTasks } from './tasks';
import type { CompanionBubblePlacement } from '../../shared/companion/bubble';
import { anchorCompanionBubble } from './bubbleAnchor';

interface Options {
  store: Pick<SqliteStore, 'get' | 'onDidChange'>;
  getMainWindow(): BrowserWindow | null;
  getCompanions(): {
    profiles: CompanionProfiles;
    chat: CompanionChat;
  };
  getTasks(): CompanionTasks;
  openTask(sessionId: string): void;
  getPetWindow?(): BrowserWindow | null;
  onVisibilityChanged?(): void;
}

let options: Options | null = null;
let window: BrowserWindow | null = null;
let shortcutAvailable = false;
let unsubscribe: (() => void) | undefined;
let unsubscribeTasks: (() => void) | undefined;
let unsubscribeActivity: (() => void) | undefined;
let unsubscribeProfiles: (() => void) | undefined;
let drainRequests: (() => Promise<void>) | undefined;
let choosingDialog = false;
let bubblePlacement: CompanionBubblePlacement | undefined;
let bubbleAnchor: ReturnType<typeof anchorCompanionBubble> | undefined;
let windowVisible = false;
let windowReady = false;
let showRequested = false;
let requestedMode: CompanionComposerMode | undefined;

export function isCompanionWindow(candidate: BrowserWindow): boolean {
  return candidate === window;
}

export function isCompanionWindowVisible(): boolean {
  return windowVisible;
}

function syncCompanionVisibility(visible: boolean): void {
  if (visible) bubbleAnchor?.activate();
  else bubbleAnchor?.deactivate();
  if (windowVisible === visible) return;
  windowVisible = visible;
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(IpcChannel.Visibility, visible);
  }
  options?.onVisibilityChanged?.();
}

/** Host suppression also updates draft/dialog visibility when native hide events are absent. */
export function hideCompanionWindow(): void {
  showRequested = false;
  requestedMode = undefined;
  if (!window || window.isDestroyed()) return;
  window.hide();
  syncCompanionVisibility(false);
}

function preferences(mode?: CompanionComposerMode): CompanionWindowContext {
  const config = options?.store.get<{ language?: string; theme?: string; themeStyle?: string }>(
    'app_config',
  );
  return {
    language: config?.language === 'en' ? 'en' : 'zh',
    theme: config?.theme === 'light' || config?.theme === 'dark' ? config.theme : 'system',
    themeStyle: typeof config?.themeStyle === 'string' ? config.themeStyle : '',
    ...(bubblePlacement ? { bubble: bubblePlacement } : {}),
    ...(mode ? { mode } : {}),
  };
}

async function snapshot(owner: BrowserWindow): Promise<CompanionWindowState> {
  if (!options) throw new Error('Companion window is not initialized');
  const { profiles, chat } = options.getCompanions();
  const identities = profiles.visibleSnapshot();
  const active = identities.profiles.find(profile => profile.petId === identities.activePetId)!;
  const availability = await chat.availability(active);
  if (!options || owner !== window || owner.isDestroyed())
    throw new Error('Companion window closed during the request');
  const conversation = chat.history(active);
  const taskSnapshot = options.getTasks().snapshot(active.petId);
  let mode: CompanionComposerMode | undefined;
  if (owner === window && !owner.isDestroyed()) {
    mode = requestedMode;
    requestedMode = undefined;
  }
  return {
    ...identities,
    context: preferences(mode),
    availability,
    shortcutAvailable,
    conversation,
    workspaces: options.getTasks().workspaces(),
    tasks: taskSnapshot.tasks,
    taskRevision: taskSnapshot.revision,
  };
}

function assertWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const owner = window;
  if (
    !options ||
    !owner ||
    owner.isDestroyed() ||
    owner.webContents.isDestroyed() ||
    event.sender !== owner.webContents ||
    event.senderFrame !== owner.webContents.mainFrame
  )
    throw new Error('Companion IPC requires an owned main frame');
  return owner;
}

function changed(): void {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(IpcChannel.Changed);
  }
}

function activeProfile(petId: string): CompanionProfile {
  const profile = options!.getCompanions().profiles.active();
  if (profile.petId !== petId) throw new Error('Companion selection changed before this request');
  return profile;
}

export function initializeCompanionWindow(next: Options): void {
  if (options) return;
  options = next;
  const { profiles, chat } = next.getCompanions();
  unsubscribeProfiles = profiles.onChanged(changed);
  unsubscribeActivity = chat.onActivity(({ petId }) => {
    if (petId === profiles.active().petId) changed();
  });
  let line = Promise.resolve();
  drainRequests = () => line;
  let queued = 0;
  const serialized = <T>(
    event: Electron.IpcMainInvokeEvent,
    operation: (owner: BrowserWindow) => Promise<T> | T,
  ): Promise<T> => {
    assertWindow(event);
    if (queued >= 8) throw new Error('Companion window request queue is full');
    queued++;
    const result = line
      .then(() => operation(assertWindow(event)))
      .finally(() => {
        queued--;
      });
    line = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  handleIpcContract(companionContract, {
    chooseWorkspace: async event => {
      const owner = assertWindow(event);
      if (choosingDialog) throw new Error('A companion dialog is already open');
      choosingDialog = true;
      try {
        const selection = await dialog.showOpenDialog(owner, {
          title: t('companionPickFolder'),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (selection.canceled || !selection.filePaths[0]) return null;
        return await serialized(event, () =>
          next.getTasks().chooseWorkspace(selection.filePaths[0]),
        );
      } finally {
        choosingDialog = false;
      }
    },
    visibility: event => {
      assertWindow(event);
      return isCompanionWindowVisible();
    },
    chooseFiles: async (event, petId) => {
      const owner = assertWindow(event);
      activeProfile(petId);
      if (choosingDialog) throw new Error('A companion dialog is already open');
      choosingDialog = true;
      try {
        const selection = await dialog.showOpenDialog(owner, {
          title: t('companionAddFiles'),
          properties: ['openFile', 'multiSelections'],
        });
        if (selection.canceled) return [];
        return await serialized(event, () => {
          activeProfile(petId);
          return next.getTasks().attachments.choose(petId, selection.filePaths);
        });
      } finally {
        choosingDialog = false;
      }
    },
    stageFile: (event, petId, file) =>
      serialized(event, () => {
        activeProfile(petId);
        return next
          .getTasks()
          .attachments.stage(
            petId,
            file,
            path.join(app.getPath('temp'), 'zhiyuan', 'attachments', 'companion'),
          );
      }),
    bootstrap: event => serialized(event, snapshot),
    select: (event, petId) =>
      serialized(event, owner => {
        profiles.select(petId);
        return snapshot(owner);
      }),
    submit: (event, request) =>
      serialized(event, () => {
        const profile = activeProfile(request.petId);
        return chat.submit(
          profile,
          request.requestId,
          request.text,
          request.attachmentIds?.length
            ? {
                ids: request.attachmentIds,
                resolve: () =>
                  next.getTasks().attachments.images(profile.petId, request.attachmentIds!),
              }
            : undefined,
        );
      }),
    stop: (event, petId) => {
      assertWindow(event);
      next.getCompanions().chat.stop(activeProfile(petId));
    },
    submitTask: (event, request) =>
      serialized(event, () =>
        next.getTasks().submit(next.getCompanions().profiles.active(), request),
      ),
    tasks: event =>
      serialized(event, () =>
        next.getTasks().snapshot(next.getCompanions().profiles.active().petId),
      ),
    stopTask: (event, sessionId) => {
      assertWindow(event);
      next.getTasks().stop(next.getCompanions().profiles.active().petId, sessionId);
    },
    hide: event => {
      assertWindow(event);
      hideCompanionWindow();
    },
    openWorkbench: (event, sessionId) => {
      assertWindow(event);
      if (sessionId) {
        if (!next.getTasks().owned(next.getCompanions().profiles.active().petId, sessionId))
          throw new Error('Task belongs to another companion');
        next.openTask(sessionId);
        return;
      }
      const main = next.getMainWindow();
      if (main && !main.isDestroyed()) {
        main.webContents.send(IpcChannel.Workbench);
        if (main.isMinimized()) main.restore();
        main.show();
        main.focus();
      }
    },
  });
  shortcutAvailable = globalShortcut.register(COMPANION_SHORTCUT, () => {
    openCompanionWindow();
  });
  unsubscribe = next.store.onDidChange('app_config', () => {
    if (window && !window.isDestroyed()) {
      window.setTitle(t('companionTitle'));
      window.webContents.send(IpcChannel.Context, preferences());
    }
  });
  unsubscribeTasks = next.getTasks().onChanged(sessionId => {
    try {
      const recipient = window;
      if (!recipient || recipient.isDestroyed() || recipient.webContents.isDestroyed()) return;
      const petId = next.getCompanions().profiles.active().petId;
      const tasks = next.getTasks();
      if (!tasks.owned(petId, sessionId)) return;
      recipient.webContents.send(IpcChannel.TasksChanged, tasks.snapshot(petId));
    } catch (error) {
      console.warn(`[Companion] Failed to project task for session ${sessionId}:`, error);
    }
  });
}

function showReadyWindow(): void {
  if (!showRequested || !windowReady || !window || window.isDestroyed()) return;
  bubbleAnchor?.place();
  if (window.isMinimized()) window.restore();
  window.show();
  syncCompanionVisibility(true);
  window.focus();
}

/** Prepare only the window shell. The hidden renderer does not load a conversation. */
export function prepareCompanionWindow(): void {
  if (!options || (window && !window.isDestroyed())) return;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(480, area.width - 16);
  const height = Math.min(400, area.height - 16);
  const created = new BrowserWindow({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 3),
    width,
    height,
    minWidth: 448,
    minHeight: 240,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: false,
    resizable: false,
    show: false,
    title: t('companionTitle'),
    skipTaskbar: true,
    focusable: true,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist-electron', 'companionWindowPreload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });
  window = created;
  windowVisible = false;
  windowReady = false;
  bubbleAnchor = anchorCompanionBubble(
    created,
    { getPetWindow: options.getPetWindow, hideWindow: hideCompanionWindow },
    placement => {
      bubblePlacement = placement;
      created.webContents.send(IpcChannel.Context, preferences());
    },
  );
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-navigate', event => event.preventDefault());
  created.once('ready-to-show', () => {
    if (!created.isDestroyed()) {
      windowReady = true;
      showReadyWindow();
    }
  });
  created.on('focus', () => {
    if (window === created && windowVisible && !created.webContents.isDestroyed())
      created.webContents.send(IpcChannel.Focus);
  });
  created.on('show', () => window === created && syncCompanionVisibility(true));
  created.on('hide', () => window === created && syncCompanionVisibility(false));
  created.on('close', event => {
    if (options && window === created) {
      event.preventDefault();
      hideCompanionWindow();
    }
  });
  created.once('closed', () => {
    if (window === created) {
      window = null;
      windowReady = false;
      showRequested = false;
      requestedMode = undefined;
      bubbleAnchor = undefined;
      syncCompanionVisibility(false);
    }
  });
  created.webContents.on('render-process-gone', (_event, details) => {
    console.warn(`[Companion] Renderer exited for window ${created.id}:`, details.reason);
    created.destroy();
  });
  const loading = app.isPackaged
    ? created.loadFile(path.join(app.getAppPath(), 'dist', COMPANION_PAGE))
    : created.loadURL(
        new URL(COMPANION_PAGE, process.env.ELECTRON_START_URL || 'http://localhost:5175/').href,
      );
  void loading.catch(error => {
    console.error(`[Companion] Failed to load window ${created.id}:`, error);
    if (!created.isDestroyed()) created.destroy();
  });
}

export function openCompanionWindow(mode?: CompanionComposerMode): void {
  if (!options) return;
  const validMode =
    mode === CompanionComposerMode.Chat || mode === CompanionComposerMode.Task ? mode : undefined;
  if (validMode) requestedMode = validMode;
  showRequested = true;
  prepareCompanionWindow();
  if (
    validMode &&
    windowReady &&
    window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed()
  ) {
    window.webContents.send(IpcChannel.Context, preferences(validMode));
    requestedMode = undefined;
  }
  showReadyWindow();
}

export function disposeCompanionWindow(): Promise<void> | undefined {
  options = null;
  const drained = drainRequests?.();
  drainRequests = undefined;
  choosingDialog = false;
  requestedMode = undefined;
  unsubscribe?.();
  unsubscribe = undefined;
  unsubscribeTasks?.();
  unsubscribeTasks = undefined;
  unsubscribeActivity?.();
  unsubscribeActivity = undefined;
  unsubscribeProfiles?.();
  unsubscribeProfiles = undefined;
  if (shortcutAvailable) globalShortcut.unregister(COMPANION_SHORTCUT);
  shortcutAvailable = false;
  window?.destroy();
  window = null;
  bubblePlacement = undefined;
  bubbleAnchor = undefined;
  windowVisible = false;
  windowReady = false;
  showRequested = false;
  for (const definition of Object.values(companionContract))
    ipcMain.removeHandler(definition.channel);
  return drained;
}
