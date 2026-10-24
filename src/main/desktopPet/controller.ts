import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import path from 'path';

import {
  DESKTOP_PET_PAGE,
  DESKTOP_PET_SIZE,
  DESKTOP_PET_STORE_KEY,
  DESKTOP_PET_TERMINAL_MS,
  DESKTOP_PET_FAILURES_KEY,
  DESKTOP_PET_DEFAULT_SETTINGS,
  DesktopPetEffectKind,
  DesktopPetIpc,
  DesktopPetPlayableAction,
  DesktopPetState,
  DesktopPetTaskResult,
} from '../../shared/desktopPet/constants';
import {
  DESKTOP_PET_CANVAS_TOP,
  DESKTOP_PET_LAYOUT_VERSION,
  DESKTOP_PET_WINDOW_HEIGHT,
} from '../../shared/desktopPet/layout';
import type {
  DesktopPetFailure,
  DesktopPetPreferences,
  DesktopPetSettings,
  DesktopPetTaskOpen,
} from '../../shared/desktopPet/types';
import { desktopPetContract } from '../../shared/desktopPet/contract';
import { desktopPetBuiltin } from '../../shared/desktopPet/catalog';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { PiUiEventType, type PiUiEvent } from '../../shared/cowork/piUiEvent';
import type { SqliteStore } from '../sqliteStore';
import { t } from '../i18n';
import { desktopPetBubbleKey } from './bubbleText';
import { DesktopPetChatter } from './chatter';
import { clampPetPosition, DesktopPetMotion, petBounds } from './motion';
import { DesktopPetStatus } from './status';
import { watchDesktopPetVisibility } from './visibility';
import { openCompanionWindow, updateActiveCompanionAppearance } from '../companion/window';

let pet: BrowserWindow | null = null;
let motion: DesktopPetMotion | undefined;
let store: Pick<SqliteStore, 'get' | 'set'> | undefined;
let mainWindow: (() => BrowserWindow | null) | undefined;
let onEnabledChanged: (() => void) | undefined;
let terminalTimer: ReturnType<typeof setTimeout> | undefined;
let greetingTimer: ReturnType<typeof setTimeout> | undefined;
let chatterTimer: ReturnType<typeof setTimeout> | undefined;
let greeting = false;
let chatter = new DesktopPetChatter();
let reducedMotion = false;
let status = new DesktopPetStatus();
let visibility: ReturnType<typeof watchDesktopPetVisibility> | undefined;
let ready = false;
let visible = false;
let requestSequence = 0;
let pendingTask: (DesktopPetTaskOpen & { failureId?: string }) | null = null;
const listeners = new Map<string, (event: Electron.IpcMainEvent, payload?: unknown) => void>();

const currentState = (): DesktopPetState =>
  greeting && status.state === DesktopPetState.Idle ? DesktopPetState.Greeting : status.state;

function sendState(): void {
  if (!pet || pet.isDestroyed() || pet.webContents.isDestroyed()) return;
  const state = currentState();
  const bubbleKey = desktopPetBubbleKey(state);
  const chatterEnabled = !bubbleKey && !reducedMotion && getDesktopPetSettings().chatter;
  if (!chatterEnabled) chatter.clear();
  const chatterKey = chatterEnabled ? chatter.activeKey() : null;
  pet.webContents.send(DesktopPetIpc.State, {
    characterId: getDesktopPetSettings().characterId,
    state,
    label: t(`desktopPet_${state}`),
    bubble: bubbleKey ? t(bubbleKey) : chatterKey ? t(chatterKey) : null,
    reducedMotion,
  });
  syncRoamAllow(state);
}

function syncRoamAllow(state: DesktopPetState): void {
  const settings = getDesktopPetSettings();
  motion?.setRoamingEnabled(settings.roaming);
  motion?.setAllowRoam(
    state === DesktopPetState.Idle && !greeting && !reducedMotion && settings.roaming,
  );
}

function chatterAllowed(state: DesktopPetState): boolean {
  const settings = getDesktopPetSettings();
  return (
    visible && settings.chatter && !reducedMotion && state === DesktopPetState.Idle && !greeting
  );
}

function stopChatterLoop(): void {
  clearTimeout(chatterTimer);
  chatterTimer = undefined;
}

function startChatterLoop(): void {
  if (chatterTimer) return;
  const step = (): void => {
    const state = currentState();
    const changed = chatter.tick(Date.now(), chatterAllowed(state));
    if (changed) sendState();
    chatterTimer = setTimeout(step, 1000);
  };
  chatter.reset(Date.now());
  chatterTimer = setTimeout(step, 1000);
}

function sendPose(facing: number, walking: boolean): void {
  if (!pet || pet.isDestroyed() || pet.webContents.isDestroyed()) return;
  pet.webContents.send(DesktopPetIpc.Pose, { facing, walking });
}

function persistPosition(): void {
  if (!pet || pet.isDestroyed() || !store) return;
  const [x, y] = pet.getPosition();
  store.set(DESKTOP_PET_STORE_KEY, {
    ...store.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY),
    x,
    y,
  });
}

function getDesktopPetSettings(): DesktopPetSettings {
  const saved = store?.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY);
  return {
    ...DESKTOP_PET_DEFAULT_SETTINGS,
    characterId:
      desktopPetBuiltin(saved?.characterId ?? '')?.id ?? DESKTOP_PET_DEFAULT_SETTINGS.characterId,
    enabled: saved?.enabled === true,
    doNotDisturb: saved?.doNotDisturb === true,
    hideInFullscreen: saved?.hideInFullscreen !== false,
    roaming: saved?.roaming !== false,
    chatter: saved?.chatter !== false,
  };
}

function migratePetLayout(preferences: DesktopPetPreferences): DesktopPetPreferences {
  if (preferences.layoutVersion === DESKTOP_PET_LAYOUT_VERSION) return preferences;
  const next = { ...preferences, layoutVersion: DESKTOP_PET_LAYOUT_VERSION };
  if (Number.isFinite(preferences.y)) next.y = preferences.y! - DESKTOP_PET_CANVAS_TOP;
  return next;
}

function publishSettings(): void {
  const window = mainWindow?.();
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
    window.webContents.send(DesktopPetIpc.SettingsChanged, getDesktopPetSettings());
  onEnabledChanged?.();
}

function sendVisibility(): void {
  pet?.webContents.send(DesktopPetIpc.Effect, { kind: DesktopPetEffectKind.Visibility, visible });
}

function syncVisibility(): void {
  if (!pet || pet.isDestroyed()) return;
  const settings = getDesktopPetSettings();
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !settings.hideInFullscreen });
  const show = ready && settings.enabled && !visibility?.suppressed(settings);
  if (show === visible) return;
  visible = show;
  // Electron can keep document.visibilityState visible after hide(); explicitly pause media.
  sendVisibility();
  if (show) {
    motion?.resume();
    startChatterLoop();
    sendState();
    pet.showInactive();
  } else {
    stopChatterLoop();
    chatter.clear();
    motion?.pause();
    pet.hide();
  }
}

function persistFailures(): void {
  try {
    store?.set(DESKTOP_PET_FAILURES_KEY, status.pendingFailures);
  } catch (error) {
    // This optional projection must never interrupt the task event pipeline.
    console.warn(
      `[DesktopPet] Failed to persist reminders for session ${status.targetSessionId ?? 'none'}:`,
      error,
    );
  }
}

function openTask(): void {
  openMainWindow();
  const sessionId = status.targetSessionId;
  const window = mainWindow?.();
  if (!sessionId || !window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  pendingTask = {
    sessionId,
    requestId: ++requestSequence,
    failureId: status.pendingFailures.find(failure => failure.sessionId === sessionId)?.eventId,
  };
  window.webContents.send(DesktopPetIpc.OpenTask, { sessionId, requestId: pendingTask.requestId });
}

function openMainWindow(): void {
  const window = mainWindow?.();
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function greet(): void {
  clearTimeout(greetingTimer);
  greeting = true;
  sendState();
  greetingTimer = setTimeout(() => {
    greeting = false;
    sendState();
  }, DESKTOP_PET_TERMINAL_MS);
}

function playAction(action: DesktopPetPlayableAction): void {
  if (!pet || pet.isDestroyed() || pet.webContents.isDestroyed()) return;
  motion?.rest();
  pet.webContents.send(DesktopPetIpc.Effect, { kind: DesktopPetEffectKind.Action, action });
  if (visible && !reducedMotion && getDesktopPetSettings().chatter) {
    chatter.showAction(action, Date.now());
    sendState();
  }
}

function showMenu(): void {
  if (!pet) return;
  Menu.buildFromTemplate([
    { label: t(`desktopPet_${currentState()}`), enabled: false },
    { type: 'separator' },
    { label: t(status.targetSessionId ? 'desktopPetOpenTask' : 'desktopPetOpen'), click: openTask },
    { label: t('companionTalk'), click: openCompanionWindow },
    { label: t('desktopPetGreet'), click: greet },
    {
      label: t('desktopPetActionPeek'),
      click: () => playAction(DesktopPetPlayableAction.Peek),
    },
    {
      label: t('desktopPetActionNod'),
      click: () => playAction(DesktopPetPlayableAction.Nod),
    },
    {
      label: t('desktopPetActionFlutter'),
      click: () => playAction(DesktopPetPlayableAction.Flutter),
    },
    { label: t('desktopPetReset'), click: () => motion?.reset() },
    { type: 'separator' },
    { label: t('desktopPetHide'), click: () => setDesktopPetEnabled(false) },
  ]).popup({ window: pet });
}

export function isDesktopPetWindow(window: BrowserWindow): boolean {
  return window === pet;
}

export function isDesktopPetEnabled(): boolean {
  return getDesktopPetSettings().enabled;
}

export function setDesktopPetAppearance(characterId: DesktopPetSettings['characterId']): void {
  if (!store) return;
  store.set(DESKTOP_PET_STORE_KEY, {
    ...store.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY),
    characterId,
  });
  publishSettings();
  sendState();
}

export function setDesktopPetEnabled(enabled: boolean): void {
  if (!store) return;
  const preferences = store.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY);
  store.set(DESKTOP_PET_STORE_KEY, { ...preferences, enabled });
  if (!enabled) {
    pet?.close();
    publishSettings();
    return;
  }
  if (pet && !pet.isDestroyed()) {
    syncVisibility();
    publishSettings();
    return;
  }
  const savedRaw = store.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY);
  const saved = migratePetLayout(savedRaw ?? { enabled: true });
  if (saved !== savedRaw) store.set(DESKTOP_PET_STORE_KEY, saved);
  const area = screen.getPrimaryDisplay().workArea;
  const candidate = {
    x: Number.isFinite(saved?.x) ? saved!.x! : area.x + area.width - DESKTOP_PET_SIZE - 24,
    y: Number.isFinite(saved?.y)
      ? saved!.y!
      : area.y + area.height - DESKTOP_PET_WINDOW_HEIGHT - 24,
  };
  const position = clampPetPosition(
    candidate,
    petBounds(screen.getDisplayNearestPoint(candidate).workArea),
  );
  const window = new BrowserWindow({
    ...position,
    width: DESKTOP_PET_SIZE,
    height: DESKTOP_PET_WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    title: t('desktopPetTitle'),
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist-electron', 'desktopPetPreload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });
  pet = window;
  ready = false;
  visible = false;
  motion = new DesktopPetMotion(
    window,
    persistPosition,
    effect => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send(DesktopPetIpc.Effect, effect);
    },
    pose => sendPose(pose.facing, pose.walking),
  );
  motion.setReducedMotion(reducedMotion);
  motion.pause();
  syncVisibility();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      ready = true;
      syncVisibility();
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.warn(`[DesktopPet] Renderer exited for window ${window.id}:`, details.reason);
    window.close();
  });
  window.webContents.on('preload-error', (_event, _preloadPath, error) => {
    console.error(`[DesktopPet] Preload failed for window ${window.id}:`, error);
    window.close();
  });
  window.once('closed', () => {
    if (pet !== window) return;
    motion?.dispose();
    motion = undefined;
    pet = null;
    visible = false;
    ready = false;
    publishSettings();
  });
  persistPosition();
  publishSettings();
  const loading = app.isPackaged
    ? window.loadFile(path.join(app.getAppPath(), 'dist', DESKTOP_PET_PAGE))
    : window.loadURL(
        new URL(
          DESKTOP_PET_PAGE,
          process.env.ELECTRON_START_URL || 'http://localhost:5175/',
        ).toString(),
      );
  void loading.catch(error => {
    console.error(`[DesktopPet] Failed to load window ${window.id}:`, error);
    if (!window.isDestroyed()) window.close();
  });
}

function onDisplayChanged(): void {
  motion?.ensureVisible();
}

export function initializeDesktopPet(
  preferences: Pick<SqliteStore, 'get' | 'set'>,
  getMainWindow: () => BrowserWindow | null,
  enabledChanged: () => void,
): void {
  if (store) return;
  store = preferences;
  mainWindow = getMainWindow;
  onEnabledChanged = enabledChanged;
  const savedFailures = store.get<DesktopPetFailure[]>(DESKTOP_PET_FAILURES_KEY);
  if (Array.isArray(savedFailures))
    status.restoreFailures(
      savedFailures.filter(
        entry => entry && typeof entry.sessionId === 'string' && typeof entry.eventId === 'string',
      ),
    );
  visibility = watchDesktopPetVisibility(mainWindow(), syncVisibility);
  const assertMain = (event: Electron.IpcMainInvokeEvent): void => {
    const window = mainWindow?.();
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Desktop companion settings require the main window');
  };
  handleIpcContract(desktopPetContract, {
    getSettings: event => {
      assertMain(event);
      return getDesktopPetSettings();
    },
    setSettings: (event, patch) => {
      assertMain(event);
      store!.set(DESKTOP_PET_STORE_KEY, {
        ...store!.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY),
        ...patch,
      });
      const settings = getDesktopPetSettings();
      if (patch.characterId) updateActiveCompanionAppearance(settings.characterId);
      setDesktopPetEnabled(settings.enabled);
      motion?.setRoamingEnabled(settings.roaming);
      syncRoamAllow(currentState());
      sendState();
      return settings;
    },
    getPendingTask: event => {
      assertMain(event);
      return pendingTask
        ? { requestId: pendingTask.requestId, sessionId: pendingTask.sessionId }
        : null;
    },
    resolveTask: (event, requestId, result) => {
      assertMain(event);
      if (!pendingTask || pendingTask.requestId !== requestId) return;
      if (result === DesktopPetTaskResult.Opened)
        status.acknowledgeFailure(pendingTask.sessionId, pendingTask.failureId);
      else if (result === DesktopPetTaskResult.Missing) status.removeSession(pendingTask.sessionId);
      pendingTask = null;
      persistFailures();
      sendState();
    },
  });
  const bind = (channel: string, handler: (payload?: unknown) => void): void => {
    const listener = (event: Electron.IpcMainEvent, payload?: unknown): void => {
      if (
        !pet ||
        event.sender !== pet.webContents ||
        event.senderFrame !== pet.webContents.mainFrame
      )
        return;
      handler(payload);
    };
    listeners.set(channel, listener);
    ipcMain.on(channel, listener);
  };
  bind(DesktopPetIpc.Ready, () => {
    sendVisibility();
    sendState();
  });
  bind(DesktopPetIpc.DragStart, () => motion?.begin());
  bind(DesktopPetIpc.DragEnd, () => {
    if (motion?.end()) {
      playAction(DesktopPetPlayableAction.Happy);
      if (status.targetSessionId) openTask();
      else greet();
    }
  });
  bind(DesktopPetIpc.Menu, showMenu);
  bind(DesktopPetIpc.Open, openTask);
  bind(DesktopPetIpc.HitMask, payload => {
    if (payload instanceof Uint8Array && payload.length === DESKTOP_PET_SIZE * DESKTOP_PET_SIZE)
      motion?.setMask(payload);
  });
  bind(DesktopPetIpc.Motion, payload => {
    if (typeof payload !== 'boolean') return;
    reducedMotion = payload;
    motion?.setReducedMotion(reducedMotion);
    sendState();
  });
  screen.on('display-removed', onDisplayChanged);
  screen.on('display-metrics-changed', onDisplayChanged);
  if (store.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY)?.enabled) setDesktopPetEnabled(true);
}

export function observeDesktopPetEvent(event: PiUiEvent): void {
  if (!status.observe(event)) return;
  persistFailures();
  if (event.type === PiUiEventType.Completed) {
    clearTimeout(terminalTimer);
    terminalTimer = setTimeout(() => {
      status.clearTerminal();
      sendState();
    }, DESKTOP_PET_TERMINAL_MS);
  }
  sendState();
}

export function disposeDesktopPet(): void {
  clearTimeout(terminalTimer);
  clearTimeout(greetingTimer);
  stopChatterLoop();
  chatter.clear();
  motion?.dispose();
  pet?.destroy();
  pet = null;
  for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener);
  listeners.clear();
  screen.removeListener('display-removed', onDisplayChanged);
  screen.removeListener('display-metrics-changed', onDisplayChanged);
  visibility?.dispose();
  visibility = undefined;
  for (const definition of Object.values(desktopPetContract))
    ipcMain.removeHandler(definition.channel);
  pendingTask = null;
  status = new DesktopPetStatus();
  store = undefined;
}
