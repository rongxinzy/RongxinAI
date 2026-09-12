/**
 * App-owned storage boundary for SoL-Pi session state.
 *
 * Upstream SoL-Pi assumes a persistent Pi session directory
 * (`ctx.sessionManager.getSessionDir()`); the app runs Pi sessions with
 * `SessionManager.inMemory`, whose session dir is the empty string — SoL-Pi
 * would throw on every storage access. Instead of switching to Pi's on-disk
 * session logs (which would create a second transcript store next to the app
 * SQLite history), we keep the in-memory manager and expose an app-owned,
 * per-session directory through a prototype-delegating wrapper. All SoL-Pi
 * archives (ObservationPack objects/ledgers) land under
 * `<userData>/solPi/sessions/<sessionId>/` and stay isolated per session.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';

/** Minimal structural type for the Pi SessionManager instances we wrap. */
export interface SolPiSessionManagerLike {
  getSessionDir(): string;
  getSessionId(): string;
}

export const SOLPI_STORAGE_DIR_NAME = 'solPi';

/** Session-id shape enforced for every directory under the storage root. */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Orphaned session dirs younger than this are never reconciled away. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export function solPiStorageRoot(userDataPath: string): string {
  return path.join(userDataPath, SOLPI_STORAGE_DIR_NAME, 'sessions');
}

export function solPiSessionStorageDir(storageRoot: string, sessionId: string): string {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('SoL-Pi storage requires a safe session id');
  }
  return path.join(storageRoot, sessionId);
}

/**
 * Wrap an in-memory Pi SessionManager so SoL-Pi's runtime-path resolution
 * (which only reads `getSessionDir()`/`getSessionId()`) sees the app-owned
 * directory. All mutation methods are inherited unchanged and stay in memory.
 */
export function createSolPiSessionManager(
  base: SolPiSessionManagerLike & Record<string, unknown>,
  storageRoot: string,
  sessionId: string,
): SolPiSessionManagerLike {
  const sessionDir = solPiSessionStorageDir(storageRoot, sessionId);
  const wrapper = Object.create(base) as unknown as SolPiSessionManagerLike &
    Record<string, unknown>;
  wrapper.getSessionDir = (): string => sessionDir;
  return wrapper;
}

/**
 * Lifecycle cleanup: remove a session's SoL-Pi archives. Async fs only (this
 * runs off the request path), best effort — a failure to delete must never
 * fail the session teardown that calls it, so this never rejects.
 */
export async function clearSolPiSessionStorage(
  storageRoot: string,
  sessionId: string,
): Promise<void> {
  try {
    const sessionDir = solPiSessionStorageDir(storageRoot, sessionId);
    await rm(sessionDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[SolPi] Failed to clean session storage for ${sessionId}:`, error);
  }
}

/**
 * Startup reconciliation: remove archive directories of sessions that no
 * longer exist in the cowork store. A directory is only removed when it has a
 * safe session-id shape, is absent from `liveSessionIds`, and has not been
 * modified for over 24 hours (belt-and-suspenders against a session being
 * recreated while we list). Never throws; returns the removed session ids.
 */
export async function reconcileSolPiSessionStorage(
  userDataPath: string,
  liveSessionIds: readonly string[],
): Promise<string[]> {
  const storageRoot = solPiStorageRoot(userDataPath);
  const live = new Set(liveSessionIds);
  const removed: string[] = [];

  let entries: Dirent[];
  try {
    entries = await readdir(storageRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return removed;
    console.warn(`[SolPi] Failed to list session storage ${storageRoot}:`, error);
    return removed;
  }

  const cutoff = Date.now() - ORPHAN_GRACE_MS;
  for (const entry of entries) {
    if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) continue;
    if (live.has(entry.name)) continue;

    const sessionDir = path.join(storageRoot, entry.name);
    try {
      const stats = await stat(sessionDir);
      if (stats.mtimeMs > cutoff) continue;
      await rm(sessionDir, { recursive: true, force: true });
      removed.push(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      console.warn(`[SolPi] Failed to reconcile session storage ${sessionDir}:`, error);
    }
  }

  if (removed.length > 0) {
    console.log(`[SolPi] Removed ${removed.length} orphaned session archive dir(s): ${removed.join(', ')}`);
  }
  return removed;
}
