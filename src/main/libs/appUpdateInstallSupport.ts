/**
 * Install-time support for the update coordinator: the freshness window, the
 * ready-file checksum reuse and the window handoff.
 *
 * These pieces are deliberately separate from the state machine so the click
 * path stays short enough to read and so the expensive work is visible in one
 * place.
 */
import { BrowserWindow } from 'electron';
import type { ProgressInfo } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';

import type { AppUpdateDownloadProgress, AppUpdateInfo } from '../../shared/appUpdate/constants';
import { sha512UpdateFile } from './appUpdateFileHasher';

/**
 * A ready update is re-checked against the manifest before installation only
 * when the last check is older than this window. Inside the window the signed
 * manifest that produced the ready state is still authoritative, so the click
 * does not pay for another two round trips.
 */
const READY_FRESHNESS_WINDOW_MS = 10 * 60 * 1000;

/** Size and modification time of the file whose digest was verified in this process. */
export type VerifiedUpdateFile = {
  filePath: string;
  size: number;
  mtimeMs: number;
};

export function isReadyUpdateStale(lastCheckedAt: number | null, now = Date.now()): boolean {
  return lastCheckedAt === null || now - lastCheckedAt > READY_FRESHNESS_WINDOW_MS;
}

/**
 * The digest computed right after the download is reused while the file is
 * unchanged; a multi-hundred-megabyte installer is not read a third time on the
 * click path. Any mismatch falls back to a full checksum and returns the identity
 * to remember.
 */
export async function verifyReadyUpdateFile(
  filePath: string,
  info: AppUpdateInfo,
  expectedSha512: string,
  verifiedFile: VerifiedUpdateFile | null,
): Promise<VerifiedUpdateFile> {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error('Downloaded update file is no longer valid');
  }
  if (path.basename(filePath) !== info.expectedUpdaterFileName) {
    throw new Error('Downloaded update filename no longer matches the signed manifest');
  }
  if (
    verifiedFile &&
    verifiedFile.filePath === filePath &&
    verifiedFile.size === stat.size &&
    verifiedFile.mtimeMs === stat.mtimeMs
  ) {
    console.debug('[AppUpdate] reusing the digest verified after download');
    return verifiedFile;
  }
  const actualSha512 = await sha512UpdateFile(filePath);
  if (actualSha512 !== expectedSha512 || actualSha512 !== info.expectedUpdaterSha512) {
    throw new Error('Downloaded update checksum verification failed');
  }
  return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
}

/** Hides the visible windows while the installer handoff runs; returns them for a restore. */
export function hideWindowsForInstall(): BrowserWindow[] {
  const hidden: BrowserWindow[] = [];
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || !window.isVisible()) continue;
    window.hide();
    hidden.push(window);
  }
  return hidden;
}

export function restoreHiddenWindows(windows: BrowserWindow[]): void {
  for (const window of windows) {
    if (window.isDestroyed()) continue;
    window.show();
    window.focus();
  }
}

/**
 * Turns electron-updater progress events into the renderer's progress shape.
 *
 * Differential downloads report one batch at a time: the byte counter restarts
 * for every batch, and copying unchanged blocks reports nothing. Once a restart
 * is seen the fraction can no longer describe the whole transfer, so it is
 * dropped in favour of the byte counter instead of showing a bar that jumps
 * backwards. The fraction is also capped below 100% because the download
 * promise still has to hash the file and re-check the manifest before it is
 * ready.
 */
export class DownloadProgressTracker {
  private unreliable = false;
  private lastTransferred: number | null = null;

  reset(): void {
    this.unreliable = false;
    this.lastTransferred = null;
  }

  observe(progress: ProgressInfo): AppUpdateDownloadProgress {
    if (this.lastTransferred !== null && progress.transferred < this.lastTransferred) {
      this.unreliable = true;
    }
    this.lastTransferred = progress.transferred;
    const total = progress.total > 0 ? progress.total : undefined;
    const fraction = total ? progress.transferred / total : undefined;
    return {
      received: progress.transferred,
      total,
      percent: fraction !== undefined && !this.unreliable ? Math.min(fraction, 0.99) : undefined,
      speed: progress.bytesPerSecond > 0 ? progress.bytesPerSecond : undefined,
    };
  }
}
