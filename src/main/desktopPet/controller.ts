import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import path from 'path';

import {
  DESKTOP_PET_PAGE,
  DESKTOP_PET_SIZE,
  DESKTOP_PET_CLICK_DELAY_MS,
  DESKTOP_PET_CLICK_ACTIONS,
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
import { CompanionComposerMode, CompanionRequestState } from '../../shared/companion/constants';
import {
  DESKTOP_PET_CANVAS_TOP,
  DESKTOP_PET_LAYOUT_VERSION,
  DESKTOP_PET_WINDOW_HEIGHT,
} from '../../shared/desktopPet/layout';
import type {
  DesktopPetFailure,
  DesktopPetPose,
  DesktopPetPreferences,
  DesktopPetSettings,
  DesktopPetTaskOpen,
} from '../../shared/desktopPet/types';
import { desktopPetContract, desktopPetEventContract } from '../../shared/desktopPet/contract';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { isDesktopPetReleased } from '../../shared/desktopPet/availability';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { listenToWindowIpcEvent } from '../ipc/listenToWindowIpcEvent';
import { PiUiEventType, type PiUiEvent } from '../../shared/cowork/piUiEvent';
import type { SqliteStore } from '../sqliteStore';
import { t } from '../i18n';
import { desktopPetBubbleKey } from './bubbleText';
import { DesktopPetChatter } from './chatter';
import { clampPetPosition, DesktopPetMotion, petBounds } from './motion';
import { DesktopPetStatus } from './status';
import { DesktopPetCompanionStatus } from './companionStatus';
import type { CompanionChat } from '../companion/chat';
import type { CompanionProfiles } from '../companion/profiles';
import { isPiCompanionChatSession } from '../libs/agentEngine/piRuntimeTypes';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import {
  hideCompanionWindow,
  isCompanionWindowVisible,
  openCompanionWindow,
  prepareCompanionWindow,
} from '../companion/window';
import { watchDesktopPetVisibility } from './visibility';
import { DesktopWindowObserver } from './windows/observer';

let pet: BrowserWindow | null = null;
let motion: DesktopPetMotion | undefined;
let windowObserver: DesktopWindowObserver | undefined;
let store: Pick<SqliteStore, 'get' | 'set'> | undefined;
let companionProfiles: CompanionProfiles | undefined;
let companionChat: Pick<CompanionChat, 'hasPendingReply'> | undefined;
let unsubscribeProfiles: (() => void) | undefined;
let unsubscribeChat: (() => void) | undefined;
let mainWindow: (() => BrowserWindow | null) | undefined;
let onEnabledChanged: (() => void) | undefined;
let terminalTimer: ReturnType<typeof setTimeout> | undefined;
let greetingTimer: ReturnType<typeof setTimeout> | undefined;
let chatterTimer: ReturnType<typeof setTimeout> | undefined;
let clickTimer: ReturnType<typeof setTimeout> | undefined;
let clickActionIndex = 0;
let greeting = false;
let sleeping = false;
let chatter = new DesktopPetChatter();
let reducedMotion = false;
type WorkRuntime = Pick<
  PiRuntimeAdapter,
  'getRunningSessionIds' | 'getPendingModalPermissionSessionId'
>;
let workRuntime: WorkRuntime | undefined;
const runningSessionId = () =>
  workRuntime?.getRunningSessionIds().find(id => !isPiCompanionChatSession(id));
const pendingPermissionSessionId = () => workRuntime?.getPendingModalPermissionSessionId();
let status = new DesktopPetStatus(runningSessionId, pendingPermissionSessionId);
let failureWritePending = false;
const companionStatus = new DesktopPetCompanionStatus(() => {
  const active = companionProfiles?.storedActive();
  return Boolean(active && companionChat?.hasPendingReply(active.petId));
}, sendState);
let menuOpen = false;
let visibility: ReturnType<typeof watchDesktopPetVisibility> | undefined;
let ready = false;
let visible = false;
let requestSequence = 0;
let pendingTask: (DesktopPetTaskOpen & { failureId?: string }) | null = null;
const eventDisposers: Array<() => void> = [];

const currentState = (state = companionStatus.project(status.state)): DesktopPetState => {
  if (state !== DesktopPetState.Idle) return state;
  if (sleeping) return DesktopPetState.Sleeping;
  return greeting ? DesktopPetState.Greeting : state;
};
function observeCompanionActivity(activity: CompanionRequestState | null): void {
  greeting = false;
  companionStatus.observe(activity, visible);
}

function sendState(): void {
  if (!pet || pet.isDestroyed() || pet.webContents.isDestroyed()) return;
  const settings = getDesktopPetSettings();
  const isXiaoyuan = settings.characterId === DesktopPetBuiltinId.Xiaoyuan;
  const bubbleOpen = isCompanionWindowVisible();
  const taskState = status.state;
  const projected = companionStatus.project(taskState);
  if (!isXiaoyuan || bubbleOpen || projected !== DesktopPetState.Idle) sleeping = false;
  motion?.setSpringDragEnabled(isXiaoyuan);
  motion?.setMediaDrivenWalk(isXiaoyuan);
  const state = currentState(projected);
  const chatLabel = companionStatus.labelKey(taskState, projected);
  const bubbleKey = chatLabel ? (bubbleOpen ? null : chatLabel) : desktopPetBubbleKey(state);
  const chatterEnabled =
    !sleeping && !chatLabel && !bubbleKey && !reducedMotion && settings.chatter;
  if (!chatterEnabled) chatter.clear();
  const chatterKey = chatterEnabled ? chatter.activeKey() : null;
  pet.webContents.send(DesktopPetIpc.State, {
    characterId: settings.characterId,
    state,
    label: t(chatLabel ?? `desktopPet_${state}`),
    bubble: bubbleKey ? t(bubbleKey) : chatterKey ? t(chatterKey) : null,
    reducedMotion,
  });
  syncRoamAllow(state);
}

function syncRoamAllow(state: DesktopPetState): void {
  const settings = getDesktopPetSettings();
  motion?.setRoamingEnabled(settings.roaming);
  motion?.setAllowRoam(
    state === DesktopPetState.Idle &&
      !isCompanionWindowVisible() &&
      !menuOpen &&
      !greeting &&
      !reducedMotion &&
      settings.roaming,
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

function clearClickTimer(): void {
  clearTimeout(clickTimer);
  clickTimer = undefined;
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

function sendPose(pose: DesktopPetPose): void {
  if (!pet || pet.isDestroyed() || pet.webContents.isDestroyed()) return;
  pet.webContents.send(DesktopPetIpc.Pose, pose);
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
  const savedAppearance = saved?.characterId;
  return {
    ...DESKTOP_PET_DEFAULT_SETTINGS,
    characterId:
      companionProfiles?.storedActive()?.characterId ??
      (savedAppearance && isDesktopPetReleased(savedAppearance)
        ? savedAppearance
        : DESKTOP_PET_DEFAULT_SETTINGS.characterId),
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
  windowObserver?.setActive(
    settings.enabled &&
      (settings.roaming || settings.hideInFullscreen) &&
      Boolean(visibility?.canObserve(settings)),
  );
  pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !settings.hideInFullscreen });
  const externalFullscreen =
    settings.hideInFullscreen &&
    Boolean(
      windowObserver?.snapshot?.fullscreenDisplays.includes(
        String(screen.getDisplayMatching(pet.getBounds()).id),
      ),
    );
  const show =
    ready && settings.enabled && !visibility?.suppressed(settings) && !externalFullscreen;
  if (show === visible) return;
  visible = show;
  // Electron can keep document.visibilityState visible after hide(); explicitly pause media.
  sendVisibility();
  if (show) {
    motion?.resume();
    startChatterLoop();
    sendState();
    pet.showInactive();
    prepareCompanionWindow();
  } else {
    companionStatus.reset();
    clearClickTimer();
    stopChatterLoop();
    chatter.clear();
    motion?.pause();
    hideCompanionWindow();
    pet.hide();
  }
}

function persistFailures(changed: boolean): void {
  if (!changed && !failureWritePending) return;
  failureWritePending = true;
  if (!store) return;
  try {
    store.set(DESKTOP_PET_FAILURES_KEY, status.pendingFailures);
    failureWritePending = false;
  } catch (error) {
    // This optional projection must never interrupt the task event pipeline.
    console.warn(
      `[DesktopPet] Failed to persist reminders for session ${status.targetSessionId ?? 'none'}:`,
      error,
    );
  }
}

function openTask(): void {
  if (status.targetSessionId) openDesktopPetSession(status.targetSessionId);
  else openMainWindow();
}
export function openDesktopPetSession(sessionId: string): void {
  openMainWindow();
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
  if (sleeping) return;
  clearTimeout(greetingTimer);
  greeting = true;
  sendState();
  greetingTimer = setTimeout(() => {
    greeting = false;
    sendState();
  }, DESKTOP_PET_TERMINAL_MS);
}

function playAction(action: DesktopPetPlayableAction, withChatter = true): void {
  if (sleeping || !pet || pet.isDestroyed() || pet.webContents.isDestroyed()) return;
  motion?.rest();
  pet.webContents.send(DesktopPetIpc.Effect, { kind: DesktopPetEffectKind.Action, action });
  if (withChatter && visible && !reducedMotion && getDesktopPetSettings().chatter) {
    chatter.showAction(action, Date.now());
    sendState();
  }
}

function setSleeping(value: boolean): void {
  if (value === sleeping) return;
  if (value && (currentState() !== DesktopPetState.Idle || isCompanionWindowVisible() || !visible))
    return;
  sleeping = value;
  sendState();
}

function togglePetSetting(key: 'roaming' | 'chatter'): void {
  if (!store) return;
  const current = getDesktopPetSettings();
  store.set(DESKTOP_PET_STORE_KEY, {
    ...store.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY),
    [key]: !current[key],
  });
  const settings = getDesktopPetSettings();
  motion?.setRoamingEnabled(settings.roaming);
  syncRoamAllow(currentState());
  publishSettings();
  sendState();
}

function showMenu(): void {
  if (!pet || menuOpen) return;
  menuOpen = true;
  motion?.rest();
  motion?.pause();
  const settings = getDesktopPetSettings();
  const wake = sleeping;
  Menu.buildFromTemplate([
    { label: t(`desktopPet_${currentState()}`), enabled: false },
    { type: 'separator' },
    {
      label: t(isCompanionWindowVisible() ? 'desktopPetCloseChat' : 'companionTalk'),
      click: () =>
        isCompanionWindowVisible()
          ? hideCompanionWindow()
          : openCompanionWindow(CompanionComposerMode.Chat),
    },
    {
      label: t('desktopPetAssignTask'),
      click: () => openCompanionWindow(CompanionComposerMode.Task),
    },
    { label: t(status.targetSessionId ? 'desktopPetOpenTask' : 'desktopPetOpen'), click: openTask },
    { type: 'separator' },
    {
      label: t('desktopPetInteract'),
      submenu: [
        { label: t('desktopPetGreet'), enabled: !wake, click: greet },
        {
          label: t('desktopPetActionPeek'),
          enabled: !wake,
          click: () => playAction(DesktopPetPlayableAction.Peek),
        },
        {
          label: t('desktopPetActionNod'),
          enabled: !wake,
          click: () => playAction(DesktopPetPlayableAction.Nod),
        },
        {
          label: t('desktopPetActionFlutter'),
          enabled: !wake,
          click: () => playAction(DesktopPetPlayableAction.Flutter),
        },
        ...(settings.characterId === DesktopPetBuiltinId.Xiaoyuan
          ? [
              {
                label: t(wake ? 'desktopPetWake' : 'desktopPetSleep'),
                enabled:
                  wake || (currentState() === DesktopPetState.Idle && !isCompanionWindowVisible()),
                click: () => setSleeping(!wake),
              },
            ]
          : []),
      ],
    },
    {
      label: t('desktopPetRoaming'),
      type: 'checkbox',
      checked: settings.roaming,
      click: () => togglePetSetting('roaming'),
    },
    {
      label: t('desktopPetChatter'),
      type: 'checkbox',
      checked: settings.chatter,
      click: () => togglePetSetting('chatter'),
    },
    { label: t('desktopPetReset'), click: () => motion?.reset() },
    { type: 'separator' },
    { label: t('desktopPetHide'), click: () => setDesktopPetEnabled(false) },
  ]).popup({
    window: pet,
    callback: () => {
      menuOpen = false;
      syncRoamAllow(currentState());
      if (visible) motion?.resume();
    },
  });
}

export function getDesktopPetWindow(): BrowserWindow | null {
  return visible && pet && !pet.isDestroyed() ? pet : null;
}
export { sendState as refreshDesktopPetState };
export function isDesktopPetEnabled(): boolean {
  return getDesktopPetSettings().enabled;
}

export function setDesktopPetEnabled(enabled: boolean): void {
  if (!store) return;
  const preferences = store.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY);
  store.set(DESKTOP_PET_STORE_KEY, { ...preferences, enabled });
  if (!enabled) {
    hideCompanionWindow();
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
    alwaysOnTop: false,
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
      if (window.isDestroyed() || window.webContents.isDestroyed()) return;
      if (effect.kind === DesktopPetEffectKind.Drag && effect.active) setSleeping(false);
      window.webContents.send(DesktopPetIpc.Effect, effect);
    },
    sendPose,
    active => {
      if (!window.isDestroyed()) window.setAlwaysOnTop(active);
    },
  );
  if (process.platform === 'win32')
    windowObserver = new DesktopWindowObserver(window, snapshot => {
      if (pet !== window) return;
      motion?.setWindowSnapshot(snapshot);
      syncVisibility();
    });
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
    hideCompanionWindow();
    const observer = windowObserver;
    windowObserver = undefined;
    observer?.dispose();
    companionStatus.reset();
    motion?.dispose();
    motion = undefined;
    pet = null;
    visible = false;
    ready = false;
    sleeping = false;
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
  windowObserver?.configure();
}

export function initializeDesktopPet(
  preferences: Pick<SqliteStore, 'get' | 'set'>,
  getMainWindow: () => BrowserWindow | null,
  enabledChanged: () => void,
  {
    profiles,
    chat,
  }: {
    profiles: CompanionProfiles;
    chat: Pick<CompanionChat, 'hasPendingReply' | 'onActivity'>;
  },
  runtime: WorkRuntime,
): void {
  if (store) return;
  store = preferences;
  workRuntime = runtime;
  mainWindow = getMainWindow;
  onEnabledChanged = enabledChanged;
  companionProfiles = profiles;
  companionChat = chat;
  unsubscribeProfiles = profiles.onChanged(activePetChanged => {
    publishSettings();
    if (activePetChanged) {
      observeCompanionActivity(null);
    } else {
      sendState();
    }
  });
  unsubscribeChat = chat.onActivity(({ petId, state }) => {
    if (petId === profiles.active().petId) observeCompanionActivity(state);
  });
  const savedFailures = store.get<DesktopPetFailure[]>(DESKTOP_PET_FAILURES_KEY);
  if (Array.isArray(savedFailures))
    status.restoreFailures(
      savedFailures.filter(
        entry => entry && typeof entry.sessionId === 'string' && typeof entry.eventId === 'string',
      ),
    );
  persistFailures(false);
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
      const { characterId, ...settingsPatch } = patch;
      if (characterId) {
        if (!isDesktopPetReleased(characterId))
          throw new Error('Desktop companion appearance is not released');
        const active = profiles.active();
        if (active.characterId !== characterId)
          profiles.changeAppearance(active.petId, characterId);
      }
      if (Object.keys(settingsPatch).length === 0) return getDesktopPetSettings();
      store!.set(DESKTOP_PET_STORE_KEY, {
        ...store!.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY),
        ...settingsPatch,
      });
      const settings = getDesktopPetSettings();
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
      let failuresChanged = false;
      if (result === DesktopPetTaskResult.Opened)
        failuresChanged = status.acknowledgeFailure(pendingTask.sessionId, pendingTask.failureId);
      else if (result === DesktopPetTaskResult.Missing)
        failuresChanged = status.removeSession(pendingTask.sessionId);
      pendingTask = null;
      persistFailures(failuresChanged);
      sendState();
    },
  });
  const petWindow = () => pet;
  eventDisposers.push(
    listenToWindowIpcEvent(desktopPetEventContract.ready, petWindow, () => {
      sendVisibility();
      sendState();
    }),
    listenToWindowIpcEvent(desktopPetEventContract.dragStart, petWindow, () => {
      clearClickTimer();
      motion?.begin();
    }),
    listenToWindowIpcEvent(desktopPetEventContract.dragEnd, petWindow, (_, cancelled) => {
      if (motion?.end(cancelled === true)) {
        clearClickTimer();
        if (sleeping) {
          setSleeping(false);
          return;
        }
        clickTimer = setTimeout(() => {
          clickTimer = undefined;
          const action =
            DESKTOP_PET_CLICK_ACTIONS[clickActionIndex++ % DESKTOP_PET_CLICK_ACTIONS.length]!;
          playAction(action, true);
        }, DESKTOP_PET_CLICK_DELAY_MS);
      }
    }),
    listenToWindowIpcEvent(desktopPetEventContract.menu, petWindow, () => {
      clearClickTimer();
      showMenu();
    }),
    listenToWindowIpcEvent(desktopPetEventContract.open, petWindow, () => {
      clearClickTimer();
      if (isCompanionWindowVisible()) hideCompanionWindow();
      else openCompanionWindow();
    }),
    listenToWindowIpcEvent(desktopPetEventContract.hitMask, petWindow, (_, mask) => {
      motion?.setMask(mask);
    }),
    listenToWindowIpcEvent(desktopPetEventContract.walkFrame, petWindow, (_, frame) => {
      if (visible) motion?.observeWalkFrame(frame);
    }),
    listenToWindowIpcEvent(desktopPetEventContract.motion, petWindow, (_, reduced) => {
      reducedMotion = reduced;
      motion?.setReducedMotion(reducedMotion);
      sendState();
    }),
  );
  screen.on('display-removed', onDisplayChanged);
  eventDisposers.push(() => screen.removeListener('display-removed', onDisplayChanged));
  screen.on('display-metrics-changed', onDisplayChanged);
  eventDisposers.push(() => screen.removeListener('display-metrics-changed', onDisplayChanged));
  if (store.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY)?.enabled) setDesktopPetEnabled(true);
}

export function observeDesktopPetEvent(event: PiUiEvent): void {
  const { presentationChanged, failuresChanged } = status.observe(event);
  if (presentationChanged || failuresChanged) persistFailures(failuresChanged);
  if (!presentationChanged) return;
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
  failureWritePending = false;
  const observer = windowObserver;
  windowObserver = undefined;
  observer?.dispose();
  clearTimeout(terminalTimer);
  clearTimeout(greetingTimer);
  clearClickTimer();
  clickActionIndex = 0;
  stopChatterLoop();
  chatter.clear();
  motion?.dispose();
  pet?.destroy();
  pet = null;
  menuOpen = false;
  sleeping = false;
  for (const dispose of eventDisposers.splice(0)) dispose();
  visibility?.dispose();
  visibility = undefined;
  for (const definition of Object.values(desktopPetContract))
    ipcMain.removeHandler(definition.channel);
  pendingTask = null;
  status = new DesktopPetStatus(runningSessionId, pendingPermissionSessionId);
  workRuntime = undefined;
  companionStatus.reset();
  unsubscribeChat?.();
  unsubscribeChat = undefined;
  unsubscribeProfiles?.();
  unsubscribeProfiles = undefined;
  companionProfiles = undefined;
  companionChat = undefined;
  store = undefined;
}
