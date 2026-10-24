import path from 'node:path';
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import { COMPANION_PAGE, COMPANION_SHORTCUT } from '../../shared/companion/constants';
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

interface Options {
  store: Pick<SqliteStore, 'get' | 'onDidChange'>;
  getMainWindow(): BrowserWindow | null;
  getCompanions(): { profiles: CompanionProfiles; runtime: PiCompanionRuntime };
  getTasks(): CompanionTasks;
  openTask(sessionId: string): void;
  onProfileChanged(profile: CompanionProfile): void;
}

let options: Options | null = null;
let window: BrowserWindow | null = null;
let shortcutAvailable = false;
let unsubscribe: (() => void) | undefined;
let unsubscribeTasks: (() => void) | undefined;

export function isCompanionWindow(candidate: BrowserWindow): boolean {
  return candidate === window;
}

export function updateActiveCompanionAppearance(
  characterId: CompanionProfile['characterId'],
): void {
  if (!options) return;
  const { profiles } = options.getCompanions();
  profiles.changeAppearance(profiles.active().petId, characterId);
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
  return {
    ...identities,
    context: preferences(),
    availability,
    shortcutAvailable,
    conversation: await runtime.history(active),
    workspaces: options.getTasks().workspaces(),
    tasks: options.getTasks().recent(active.petId),
  };
}

function assertWindow(event: Electron.IpcMainInvokeEvent): void {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error('Companion IPC requires its owned main frame');
}

export function initializeCompanionWindow(next: Options): void {
  if (options) return;
  options = next;
  let line: Promise<unknown> = Promise.resolve();
  let queued = 0;
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
    bootstrap: event => serialized(event, snapshot),
    select: (event, petId) =>
      serialized(event, () => {
        const selected = next.getCompanions().profiles.select(petId);
        next.onProfileChanged(selected);
        return snapshot();
      }),
    submit: (event, request) =>
      serialized(event, () => {
        const { profiles, runtime } = next.getCompanions();
        return runtime.submit(profiles.active(), request.requestId, request.text);
      }),
    answer: (event, receipt) =>
      serialized(event, () => {
        const { profiles, runtime } = next.getCompanions();
        return runtime.answer(profiles.active(), receipt);
      }),
    stop: event =>
      serialized(event, () => {
        const { profiles, runtime } = next.getCompanions();
        return runtime.stop(profiles.active());
      }),
    submitTask: (event, request) =>
      serialized(event, () =>
        next.getTasks().submit(next.getCompanions().profiles.active(), request),
      ),
    tasks: event =>
      serialized(event, () => next.getTasks().recent(next.getCompanions().profiles.active().petId)),
    stopTask: (event, sessionId) =>
      serialized(event, () =>
        next.getTasks().stop(next.getCompanions().profiles.active().petId, sessionId),
      ),
    hide: event => {
      assertWindow(event);
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
    if (!window || window.isDestroyed()) return;
    try {
      const petId = next.getCompanions().profiles.active().petId;
      if (next.getTasks().owned(petId, sessionId))
        window.webContents.send(IpcChannel.TasksChanged, {
          petId,
          tasks: next.getTasks().recent(petId),
        });
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
