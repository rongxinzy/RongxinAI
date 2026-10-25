import path from 'node:path';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } from 'electron';
import {
  COMPANION_PAGE,
  COMPANION_SHORTCUT,
  CompanionRequestState,
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
import type { PiCompanionRuntime } from './durableRuntime.mjs';
import type { CompanionTasks } from './tasks';
import type { CompanionMemoryService } from './memory';

interface Options {
  store: Pick<SqliteStore, 'get' | 'onDidChange'>;
  getMainWindow(): BrowserWindow | null;
  getCompanions(): {
    profiles: CompanionProfiles;
    runtime: PiCompanionRuntime;
    memory?: CompanionMemoryService | null;
  };
  getTasks(): CompanionTasks;
  openTask(sessionId: string): void;
  onProfileChanged(profile: CompanionProfile): void;
}

let options: Options | null = null;
let window: BrowserWindow | null = null;
let shortcutAvailable = false;
let unsubscribe: (() => void) | undefined;
let unsubscribeTasks: (() => void) | undefined;
let choosingDialog = false;

export function isCompanionWindow(candidate: BrowserWindow): boolean {
  return candidate === window;
}

export function updateActiveCompanionAppearance(
  characterId: CompanionProfile['characterId'],
): void {
  if (!options) return;
  const { profiles } = options.getCompanions();
  const active = profiles.active();
  if (active.characterId === characterId) return;
  profiles.changeAppearance(active.petId, characterId);
  changed();
}

function preferences(): CompanionWindowContext {
  const config = options?.store.get<{ language?: string; theme?: string; themeStyle?: string }>(
    'app_config',
  );
  return {
    language: config?.language === 'en' ? 'en' : 'zh',
    theme: config?.theme === 'light' || config?.theme === 'dark' ? config.theme : 'system',
    themeStyle: typeof config?.themeStyle === 'string' ? config.themeStyle : '',
  };
}

async function snapshot(): Promise<CompanionWindowState> {
  if (!options) throw new Error('Companion window is not initialized');
  const { profiles, runtime } = options.getCompanions();
  const identities = profiles.snapshot();
  const active = identities.profiles.find(profile => profile.petId === identities.activePetId)!;
  const availability = await runtime.resume(active);
  const conversation = await runtime.history(active);
  const taskSnapshot = options.getTasks().snapshot(active.petId);
  return {
    ...identities,
    context: preferences(),
    availability,
    shortcutAvailable,
    conversation,
    workspaces: options.getTasks().workspaces(),
    tasks: taskSnapshot.tasks,
    taskRevision: taskSnapshot.revision,
  };
}

function surfaces(): BrowserWindow[] {
  return [window, options?.getMainWindow()].filter((candidate): candidate is BrowserWindow =>
    Boolean(candidate && !candidate.isDestroyed()),
  );
}

function assertWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const owner = surfaces().find(
    candidate =>
      event.sender === candidate.webContents &&
      event.senderFrame === candidate.webContents.mainFrame,
  );
  if (!owner) throw new Error('Companion IPC requires an owned main frame');
  return owner;
}

function changed(): void {
  for (const surface of surfaces()) surface.webContents.send(IpcChannel.Changed);
}

function activeProfile(petId: string): CompanionProfile {
  const profile = options!.getCompanions().profiles.active();
  if (profile.petId !== petId) throw new Error('Companion selection changed before this request');
  return profile;
}

function memoryService(): CompanionMemoryService {
  const service = options?.getCompanions().memory;
  if (!service) throw new Error(t('companionMemoryUnavailable'));
  return service;
}

export function initializeCompanionWindow(next: Options): void {
  if (options) return;
  options = next;
  let line: Promise<unknown> = Promise.resolve();
  let queued = 0;
  const publishedReplies = new Set<string>();
  const serialized = <T>(
    event: Electron.IpcMainInvokeEvent,
    operation: () => Promise<T> | T,
  ): Promise<T> => {
    assertWindow(event);
    if (queued >= 8) throw new Error('Companion window request queue is full');
    queued++;
    const result = line
      .then(() => {
        assertWindow(event);
        return operation();
      })
      .finally(() => {
        queued--;
      });
    line = result.catch(() => {});
    return result;
  };
  handleIpcContract(companionContract, {
    listMemories: (event, petId) =>
      serialized(event, () => {
        activeProfile(petId);
        return memoryService().list(petId);
      }),
    saveMemory: (event, input) =>
      serialized(event, async () => {
        activeProfile(input.petId);
        const saved = await memoryService().save(input);
        changed();
        return saved;
      }),
    forgetMemory: (event, petId, id) =>
      serialized(event, async () => {
        activeProfile(petId);
        const forgotten = await memoryService().forget(petId, id);
        changed();
        return forgotten;
      }),
    confirmMemory: (event, input) =>
      serialized(event, async () => {
        activeProfile(input.petId);
        const saved = await memoryService().confirm(input);
        changed();
        return saved;
      }),
    shareMemory: (event, input) =>
      serialized(event, async () => {
        activeProfile(input.petId);
        const id = await memoryService().shareConfirmed(input.petId, input.id, input.requestId);
        changed();
        return id;
      }),
    chooseWorkspace: async event => {
      const owner = assertWindow(event);
      if (choosingDialog) throw new Error('A companion dialog is already open');
      choosingDialog = true;
      try {
        const selection = await dialog.showOpenDialog(owner, {
          title: t('companionPickFolder'),
          properties: ['openDirectory', 'createDirectory'],
        });
        assertWindow(event);
        if (selection.canceled || !selection.filePaths[0]) return null;
        return await next.getTasks().chooseWorkspace(selection.filePaths[0]);
      } finally {
        choosingDialog = false;
      }
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
    bootstrap: event => serialized(event, snapshot),
    select: (event, petId) =>
      serialized(event, async () => {
        const selected = next.getCompanions().profiles.select(petId);
        next.onProfileChanged(selected);
        const state = await snapshot();
        changed();
        return state;
      }),
    submit: (event, request) =>
      serialized(event, async () => {
        const profile = activeProfile(request.petId);
        const result = await next
          .getCompanions()
          .runtime.submit(profile, request.requestId, request.text);
        if (result.receipt) changed();
        return result;
      }),
    answer: (event, receipt) =>
      serialized(event, async () => {
        const result = await next
          .getCompanions()
          .runtime.answer(activeProfile(receipt.petId), receipt);
        if (result.state !== CompanionRequestState.Accepted) {
          const key = `${receipt.petId}:${receipt.submissionId}`;
          if (!publishedReplies.has(key)) {
            publishedReplies.add(key);
            if (publishedReplies.size > 128)
              publishedReplies.delete(publishedReplies.values().next().value!);
            changed();
          }
        }
        return result;
      }),
    stop: (event, petId) =>
      serialized(event, async () => {
        await next.getCompanions().runtime.stop(activeProfile(petId));
        changed();
      }),
    submitTask: (event, request) =>
      serialized(event, () =>
        next.getTasks().submit(next.getCompanions().profiles.active(), request),
      ),
    tasks: event =>
      serialized(event, () =>
        next.getTasks().snapshot(next.getCompanions().profiles.active().petId),
      ),
    stopTask: (event, sessionId) =>
      serialized(event, () =>
        next.getTasks().stop(next.getCompanions().profiles.active().petId, sessionId),
      ),
    hide: event => {
      if (assertWindow(event) !== window) throw new Error('Only the quick window can hide itself');
      window?.hide();
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
      const petId = next.getCompanions().profiles.active().petId;
      if (next.getTasks().owned(petId, sessionId))
        for (const surface of surfaces())
          surface.webContents.send(IpcChannel.TasksChanged, next.getTasks().snapshot(petId));
    } catch (error) {
      console.warn(`[Companion] Failed to project task for session ${sessionId}:`, error);
    }
  });
}

export function openCompanionWindow(): void {
  if (!options) return;
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(560, area.width);
  const height = Math.min(640, area.height);
  const created = new BrowserWindow({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 3),
    width,
    height,
    minWidth: 448,
    minHeight: 400,
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
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-navigate', event => event.preventDefault());
  created.once('ready-to-show', () => {
    if (!created.isDestroyed()) {
      created.show();
      created.focus();
    }
  });
  created.on('show', () => created.webContents.send(IpcChannel.Visibility, true));
  created.on('hide', () => created.webContents.send(IpcChannel.Visibility, false));
  created.on('close', event => {
    if (options) {
      event.preventDefault();
      created.hide();
    }
  });
  created.once('closed', () => {
    if (window === created) window = null;
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

export function disposeCompanionWindow(): void {
  options = null;
  choosingDialog = false;
  unsubscribe?.();
  unsubscribe = undefined;
  unsubscribeTasks?.();
  unsubscribeTasks = undefined;
  if (shortcutAvailable) globalShortcut.unregister(COMPANION_SHORTCUT);
  shortcutAvailable = false;
  window?.destroy();
  window = null;
  for (const definition of Object.values(companionContract))
    ipcMain.removeHandler(definition.channel);
}
