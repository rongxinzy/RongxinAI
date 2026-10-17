/**
 * System preload surface, split from `../electron.d.ts`.
 *
 * Native dialogs, project directory helpers, shell integration and app
 * lifecycle: version info, update flow and log export.
 */
import type {
  AppUpdateCheckResult,
  AppUpdateRuntimeState,
} from '../../../shared/appUpdate/constants';

export interface DialogApi {
  selectDirectory: (options?: {
    defaultPath?: string;
  }) => Promise<{ success: boolean; path: string | null }>;
  selectFile: (options?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ success: boolean; path: string | null }>;
  selectFiles: (options?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ success: boolean; paths: string[] }>;
  saveInlineFile: (options: {
    dataBase64: string;
    fileName?: string;
    mimeType?: string;
    cwd?: string;
  }) => Promise<{ success: boolean; path: string | null; error?: string }>;
  readFileAsDataUrl: (
    filePath: string,
  ) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
  checkArtifactFile: (filePath: string) => Promise<{ success: boolean }>;
  generateThumbnail: (
    filePath: string,
  ) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
  showMessageBox: (options: {
    message: string;
    type?: 'none' | 'info' | 'error' | 'question' | 'warning';
    title?: string;
  }) => Promise<{ response: number }>;
}

export interface ProjectApi {
  getDefaultBaseDir: () => Promise<{ success: boolean; path: string | null; error?: string }>;
  createDirectory: (options: { name: string; baseDir?: string }) => Promise<{
    success: boolean;
    path: string | null;
    code?: 'invalid-name' | 'already-exists';
    error?: string;
  }>;
  ensureScratchDir: () => Promise<{ success: boolean; path: string | null; error?: string }>;
  createRandomWorkspace: () => Promise<{ success: boolean; path: string | null; error?: string }>;
}

export interface ShellApi {
  openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
  openHtmlInBrowser: (htmlContent: string) => Promise<{ success: boolean; error?: string }>;
  pathExists: (filePath: string) => Promise<{ success: boolean; exists: boolean; error?: string }>;
}

export interface AppInfoApi {
  getVersion: () => Promise<string>;
  isDev: () => Promise<boolean>;
  isEnterprise: () => Promise<boolean>;
  getSystemLocale: () => Promise<string>;
  consumePendingLocalInferenceInstall: () => Promise<string | null>;
  relaunch: () => Promise<void>;
}

export interface AppUpdateApi {
  getState: () => Promise<AppUpdateRuntimeState>;
  checkNow: (options?: {
    manual?: boolean;
    userId?: string | null;
  }) => Promise<AppUpdateCheckResult>;
  retryDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
  pauseDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
  resumeDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
  cancelDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
  installReady: () => Promise<{ success: boolean; state: AppUpdateRuntimeState; error?: string }>;
  revealDownload: () => Promise<{ success: boolean; path?: string; error?: string }>;
  onStateChanged: (callback: (data: AppUpdateRuntimeState) => void) => () => void;
}

export interface LogApi {
  getPath: () => Promise<string>;
  openFolder: () => Promise<void>;
  exportZip: () => Promise<{
    success: boolean;
    canceled?: boolean;
    path?: string;
    missingEntries?: string[];
    error?: string;
  }>;
  fromRenderer: (level: string, tag: string, message: string) => void;
}
