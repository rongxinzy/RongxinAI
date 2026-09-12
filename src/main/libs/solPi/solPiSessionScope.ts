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
import { existsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';

import { loadSolPiVendor } from './solPiVendor';

/** Minimal structural type for the Pi SessionManager instances we wrap. */
export interface SolPiSessionManagerLike {
  getSessionDir(): string;
  getSessionId(): string;
}

export const SOLPI_STORAGE_DIR_NAME = 'solPi';

/**
 * Session-id shape every storage directory name must satisfy after encoding.
 * Raw cowork session ids may contain characters that are unsafe as directory
 * names on some platform (e.g. `:` in `scheduled-task:<id>` on Windows), so
 * {@link encodeSolPiSessionId} percent-encodes everything outside the safe
 * alphabet instead of rejecting the id; the encoded output adds `%` to the
 * alphabet. The pattern is a belt-and-suspenders guard — encoding produces
 * matching names by construction.
 */
const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9._%-]+$/;

/** Orphaned session dirs younger than this are never reconciled away. */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Reconcile eligibility: encoded session names that also start with an
 * alphanumeric character. A leading dot keeps hidden/OS directories out of
 * reconciliation's reach, exactly like the pre-encoding behavior.
 */
const RECONCILABLE_SESSION_DIR_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._%-]*$/;

/**
 * Filesystem-safe, injective encoding of a cowork session id: every UTF-16
 * code unit outside [a-zA-Z0-9._-] (including `%` itself) becomes `%` plus
 * exactly four uppercase hex digits. Fixed four-digit escapes keep the
 * mapping injective for any id — shorter variable-length escapes would let
 * distinct ids collide (e.g. 'Ā', U+0100, and '\\u0010' + '0' both encode to
 * '%100'). Pure-safe ids encode to themselves, so existing directories keep
 * resolving.
 */
export function encodeSolPiSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
  );
}

export function solPiStorageRoot(userDataPath: string): string {
  return path.join(userDataPath, SOLPI_STORAGE_DIR_NAME, 'sessions');
}

export function solPiSessionStorageDir(storageRoot: string, sessionId: string): string {
  const encoded = encodeSolPiSessionId(sessionId);
  if (!SAFE_SESSION_ID_PATTERN.test(encoded) || encoded === '.' || encoded === '..') {
    throw new Error('SoL-Pi storage requires a safe session id');
  }
  return path.join(storageRoot, encoded);
}

/**
 * Drop the vendored observation pack's cached archive budget for a session's
 * runtime root, so a session recreated in the same process re-measures from
 * disk instead of inheriting the deleted directory's byte count. Lazy: the
 * vendor module is only loaded when the session actually has an archive.
 */
async function releaseArchiveBudgetFor(sessionDir: string): Promise<void> {
  try {
    const runtimeRoot = path.join(sessionDir, 'sol-pi');
    if (!existsSync(runtimeRoot)) return;
    const vendor = await loadSolPiVendor();
    vendor.releaseArchiveBudget?.(runtimeRoot);
  } catch (error) {
    console.warn('[SolPi] Failed to release the archive budget during cleanup:', error);
  }
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
    // Release the in-process archive budget before the directory disappears
    // (a same-process recreation of this session id must re-measure from
    // disk). Startup reconciliation needs no release: a fresh process has an
    // empty budget map.
    await releaseArchiveBudgetFor(sessionDir);
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
 * recreated while we list). Never throws; returns the removed encoded session
 * directory names (the on-disk form, not raw session ids).
 */
export async function reconcileSolPiSessionStorage(
  userDataPath: string,
  liveSessionIds: readonly string[],
): Promise<string[]> {
  const storageRoot = solPiStorageRoot(userDataPath);
  // Directory names are encoded session ids (see encodeSolPiSessionId), so
  // liveness is compared on the encoded form.
  const live = new Set(liveSessionIds.map(encodeSolPiSessionId));
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
    if (!entry.isDirectory() || !RECONCILABLE_SESSION_DIR_PATTERN.test(entry.name)) continue;
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
