import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import path from 'path';

import {
  DESKTOP_PET_PAGE,
  DESKTOP_PET_SIZE,
  DESKTOP_PET_STORE_KEY,
  DESKTOP_PET_TERMINAL_MS,
  DesktopPetIpc,
  DesktopPetState,
} from '../../shared/desktopPet/constants';
import type { DesktopPetPreferences } from '../../shared/desktopPet/types';
import type { PiUiEvent } from '../../shared/cowork/piUiEvent';
import type { SqliteStore } from '../sqliteStore';
import { t } from '../i18n';
import { clampPetPosition, DesktopPetMotion, petBounds } from './motion';
import { DesktopPetStatus } from './status';

let pet: BrowserWindow | null = null;
let motion: DesktopPetMotion | undefined;
let store: Pick<SqliteStore, 'get' | 'set'> | undefined;
let mainWindow: (() => BrowserWindow | null) | undefined;
let onEnabledChanged: (() => void) | undefined;
let terminalTimer: ReturnType<typeof setTimeout> | undefined;
let greetingTimer: ReturnType<typeof setTimeout> | undefined;
let greeting = false;
let reducedMotion = false;
const status = new DesktopPetStatus();
const listeners = new Map<string, (event: Electron.IpcMainEvent, payload?: unknown) => void>();

const currentState = (): DesktopPetState =>
  greeting && status.state === DesktopPetState.Idle ? DesktopPetState.Greeting : status.state;

function sendState(): void {
  if (!pet || pet.isDestroyed() || pet.webContents.isDestroyed()) return;
  const state = currentState();
  pet.webContents.send(DesktopPetIpc.State, {
    state,
    label: t(`desktopPet_${state}`),
    reducedMotion,
  });
}

function persistPosition(): void {
  if (!pet || pet.isDestroyed() || !store) return;
  const [x, y] = pet.getPosition();
  store.set(DESKTOP_PET_STORE_KEY, { enabled: true, x, y });
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
  }, 1800);
}

function showMenu(): void {
  if (!pet) return;
  Menu.buildFromTemplate([
    { label: t(`desktopPet_${currentState()}`), enabled: false },
    { type: 'separator' },
    { label: t('desktopPetOpen'), click: openMainWindow },
    { label: t('desktopPetGreet'), click: greet },
    { label: t('desktopPetReset'), click: () => motion?.reset() },
    { type: 'separator' },
    { label: t('desktopPetHide'), click: () => setDesktopPetEnabled(false) },
  ]).popup({ window: pet });
}

export function isDesktopPetWindow(window: BrowserWindow): boolean {
  return window === pet;
}

export function isDesktopPetEnabled(): boolean {
  return Boolean(pet && !pet.isDestroyed());
}

export function setDesktopPetEnabled(enabled: boolean): void {
  if (!store || enabled === isDesktopPetEnabled()) return;
  if (!enabled) {
    const saved = store.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY);
    store.set(DESKTOP_PET_STORE_KEY, { ...saved, enabled: false });
    pet?.close();
    return;
  }
  const saved = store.get<DesktopPetPreferences>(DESKTOP_PET_STORE_KEY);
  const area = screen.getPrimaryDisplay().workArea;
  const candidate = {
    x: Number.isFinite(saved?.x) ? saved!.x! : area.x + area.width - DESKTOP_PET_SIZE - 24,
    y: Number.isFinite(saved?.y) ? saved!.y! : area.y + area.height - DESKTOP_PET_SIZE - 24,
  };
  const position = clampPetPosition(
    candidate,
    petBounds(screen.getDisplayNearestPoint(candidate).workArea),
  );
  const window = new BrowserWindow({
    ...position,
    width: DESKTOP_PET_SIZE,
    height: DESKTOP_PET_SIZE,
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
  motion = new DesktopPetMotion(window, persistPosition);
  motion.setReducedMotion(reducedMotion);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.showInactive();
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
    motion?.dispose();
    motion = undefined;
    pet = null;
    onEnabledChanged?.();
  });
  persistPosition();
  onEnabledChanged?.();
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
  bind(DesktopPetIpc.Ready, sendState);
  bind(DesktopPetIpc.DragStart, () => motion?.begin());
  bind(DesktopPetIpc.DragEnd, () => {
    if (motion?.end()) greet();
  });
  bind(DesktopPetIpc.Menu, showMenu);
  bind(DesktopPetIpc.Open, openMainWindow);
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
  clearTimeout(terminalTimer);
  if (status.state === DesktopPetState.Completed || status.state === DesktopPetState.Error) {
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
  motion?.dispose();
  pet?.destroy();
  pet = null;
  for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener);
  listeners.clear();
  screen.removeListener('display-removed', onDisplayChanged);
  screen.removeListener('display-metrics-changed', onDisplayChanged);
  store = undefined;
}
