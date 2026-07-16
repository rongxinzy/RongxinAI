import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

import type { LlamaCppOpenModelLaunchLogWindowInput } from '../../shared/llamacpp';
import {
  LlamaCppIpcChannel,
  LlamaCppModelLaunchLogWindowQuery,
  LlamaCppModelLaunchLogWindowView,
} from '../../shared/llamacpp';
import { t } from '../i18n';

const DEFAULT_DEV_SERVER_URL = 'http://localhost:5175';
const LOG_WINDOW_WIDTH = 960;
const LOG_WINDOW_HEIGHT = 680;

let modelLaunchLogWindow: BrowserWindow | null = null;

export async function openLlamaCppModelLaunchLogWindow(
  input: LlamaCppOpenModelLaunchLogWindowInput,
): Promise<void> {
  const existingWindow = getActiveModelLaunchLogWindow();
  if (existingWindow) {
    updateModelLaunchLogWindowTarget(existingWindow, input);
    revealModelLaunchLogWindow(existingWindow);
    return;
  }

  const window = new BrowserWindow({
    width: LOG_WINDOW_WIDTH,
    height: LOG_WINDOW_HEIGHT,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: getModelLaunchLogWindowTitle(input),
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: getLogWindowPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });
  modelLaunchLogWindow = window;
  bindModelLaunchLogWindowDiagnostics(window);

  window.once('ready-to-show', () => {
    if (window.isDestroyed()) return;
    window.show();
  });

  window.on('closed', () => {
    if (modelLaunchLogWindow === window) {
      modelLaunchLogWindow = null;
    }
  });

  const query = buildLogWindowQuery(input);
  if (app.isPackaged) {
    await window.loadFile(getLogWindowIndexHtmlPath(), { query });
    return;
  }

  const url = new URL(process.env.ELECTRON_START_URL || DEFAULT_DEV_SERVER_URL);
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  await window.loadURL(url.toString());
}



function getLogWindowIndexHtmlPath(): string {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'index.html'),
    path.join(__dirname, '..', '..', '..', 'dist', 'index.html'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0];
}

function getLogWindowPreloadPath(): string {
  const candidates = [
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, '..', 'preload.js'),
    path.join(__dirname, '..', 'dist-electron', 'preload.js'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0];
}

function bindModelLaunchLogWindowDiagnostics(window: BrowserWindow): void {
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error('[LlamaCpp] Model launch log window failed to load:', {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[LlamaCpp] Model launch log window preload failed:', preloadPath, error);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[LlamaCpp] Model launch log window renderer process exited:', details);
  });

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return;
    const detail = `${message} (${sourceId}:${line})`;
    if (level >= 3) {
      console.error('[LlamaCpp] Model launch log window renderer error:', detail);
      return;
    }
    console.warn('[LlamaCpp] Model launch log window renderer warning:', detail);
  });
}

function getActiveModelLaunchLogWindow(): BrowserWindow | null {
  if (!modelLaunchLogWindow) return null;
  if (modelLaunchLogWindow.isDestroyed()) {
    modelLaunchLogWindow = null;
    return null;
  }
  return modelLaunchLogWindow;
}

function revealModelLaunchLogWindow(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }
  if (!window.isVisible()) {
    window.show();
  }
  window.focus();
}

function updateModelLaunchLogWindowTarget(
  window: BrowserWindow,
  input: LlamaCppOpenModelLaunchLogWindowInput,
): void {
  window.setTitle(getModelLaunchLogWindowTitle(input));
  if (window.webContents.isDestroyed()) return;

  const sendTarget = () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.send(LlamaCppIpcChannel.ModelLaunchLogWindowTargetChanged, input);
  };

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', sendTarget);
    return;
  }
  sendTarget();
}

function getModelLaunchLogWindowTitle(input: LlamaCppOpenModelLaunchLogWindowInput): string {
  return input.modelName
    ? `${t('llamacppModelLaunchLogWindowTitle')} - ${input.modelName}`
    : t('llamacppModelLaunchLogWindowTitle');
}

function buildLogWindowQuery(
  input: LlamaCppOpenModelLaunchLogWindowInput,
): Record<string, string> {
  return {
    [LlamaCppModelLaunchLogWindowQuery.View]: LlamaCppModelLaunchLogWindowView.ModelLaunchLog,
    ...(input.sessionId ? { [LlamaCppModelLaunchLogWindowQuery.SessionId]: input.sessionId } : {}),
    ...(input.modelName ? { [LlamaCppModelLaunchLogWindowQuery.ModelName]: input.modelName } : {}),
  };
}
