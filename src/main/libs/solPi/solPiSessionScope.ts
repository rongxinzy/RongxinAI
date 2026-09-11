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
import { rmSync } from 'node:fs';
import path from 'node:path';

/** Minimal structural type for the Pi SessionManager instances we wrap. */
export interface SolPiSessionManagerLike {
  getSessionDir(): string;
  getSessionId(): string;
}

export const SOLPI_STORAGE_DIR_NAME = 'solPi';

export function solPiStorageRoot(userDataPath: string): string {
  return path.join(userDataPath, SOLPI_STORAGE_DIR_NAME, 'sessions');
}

export function solPiSessionStorageDir(storageRoot: string, sessionId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(sessionId)) {
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
 * Lifecycle cleanup: remove a session's SoL-Pi archives. Best effort — a
 * failure to delete must never fail the session teardown that calls it.
 */
export function clearSolPiSessionStorage(storageRoot: string, sessionId: string): void {
  const sessionDir = solPiSessionStorageDir(storageRoot, sessionId);
  try {
    rmSync(sessionDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[SolPi] Failed to clean session storage ${sessionDir}:`, error);
  }
}
