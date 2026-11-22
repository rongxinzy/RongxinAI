/**
 * File-backed Pi session persistence.
 *
 * One Pi session directory per SQLite session lifetime under
 * `<root>/pi-sessions/`. A persisted SessionManager keeps
 * the structured transcript (tool calls/results, images, thinking) in Pi's
 * own JSONL, so a rebuild — app restart, idle eviction, model/skills/MCP
 * topology recreation — reopens that file and continues with structured
 * history instead of flattening the SQLite transcript into one text prompt.
 *
 * The SQLite transcript stays the UI source of truth; the JSONL exists only
 * to restore the model context. A new SQLite row has its own history key,
 * so it cannot reopen files left behind by failed deletion cleanup. SQLite
 * recovery quarantines the native history separately.
 */

import { createHash } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { removeSessionDirectory } from '../../removeSessionDirectory';
import { installPiSessionManagerGuards } from './piBoundedCompaction';

/** Directory under the injected root holding every session's Pi JSONL. */
export const PI_SESSIONS_ROOT_DIR = 'pi-sessions';
export const PI_SESSION_GENERATIONS_DIR = '.by-generation';
export const PI_COMPANION_SESSIONS_ROOT_DIR = 'companion-chat';

/**
 * Filesystem-safe directory name for one Cowork session. Session ids are
 * normally uuidv4, but stores accept caller-provided ids, so anything that
 * could escape the directory (`..`, separators) is folded into `_`.
 */
const sanitizeSessionDirName = (coworkSessionId: string): string => {
  const safe = coworkSessionId.replace(/[^A-Za-z0-9._-]+/g, '_');
  const trimmed = safe.replace(/^([._-]+)|([._-]+)$/g, '');
  return trimmed || 'session';
};

/** Existing rows without a history key retain their original directories. */
export function piSessionDirFor(
  rootDir: string,
  coworkSessionId: string,
  piHistoryKey?: string | null,
): string {
  const root = path.join(rootDir, PI_SESSIONS_ROOT_DIR);
  if (piHistoryKey == null) return path.join(root, sanitizeSessionDirName(coworkSessionId));
  return path.join(
    root,
    PI_SESSION_GENERATIONS_DIR,
    createHash('sha256').update(piHistoryKey).digest('hex'),
  );
}

/**
 * Resolves what the SessionManager should open for one Cowork session.
 *
 * A directory holds at most one file: sessions are recreated, never forked
 * in place. Multiple files (manual copy, crashed rewrite) resolve to the most
 * recently modified one, which matches `continueRecent`'s selection rule.
 */
export async function resolvePiSessionStoreFile(
  rootDir: string,
  coworkSessionId: string,
  signal?: AbortSignal,
  piHistoryKey?: string | null,
): Promise<{ sessionDir: string; sessionFile: string | null }> {
  signal?.throwIfAborted();
  const sessionDir = piSessionDirFor(rootDir, coworkSessionId, piHistoryKey);
  const entries = await fs.promises
    .readdir(sessionDir)
    .catch((error: NodeJS.ErrnoException): string[] => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  let sessionFile: string | null = null;
  let newest = -Infinity;
  for (const entry of entries) {
    signal?.throwIfAborted();
    if (!entry.endsWith('.jsonl')) continue;
    const candidate = path.join(sessionDir, entry);
    const info = await fs.promises.stat(candidate);
    if (info.isFile() && info.mtimeMs > newest) {
      sessionFile = candidate;
      newest = info.mtimeMs;
    }
  }
  signal?.throwIfAborted();
  return { sessionDir, sessionFile };
}

/** The static SessionManager surface this store drives. */
type PiSessionManagerModule = {
  create(cwd: string, sessionDir?: string, options?: { id?: string }): unknown;
  open(sessionFile: string, sessionDir?: string, cwdOverride?: string): unknown;
};

/**
 * Builds the persistent SessionManager the adapter hands to Pi.
 *
 * `open` on the resolved file restores the structured history; `create`
 * starts a fresh session (Pi names the file `<timestamp>_<id>.jsonl` and
 * writes it lazily, once the first user/assistant message exists). The
 * `cwdOverride` keeps a reopened session in the workspace this rebuild runs
 * under, not the one recorded in the file header.
 */
export async function openPersistentPiSessionManager(
  SessionManager: PiSessionManagerModule,
  rootDir: string,
  coworkSessionId: string,
  workspaceRoot: string,
  signal: AbortSignal,
  piHistoryKey?: string | null,
): Promise<{ manager: unknown; reusedFile: boolean }> {
  const { sessionDir, sessionFile } = await resolvePiSessionStoreFile(
    rootDir,
    coworkSessionId,
    signal,
    piHistoryKey,
  );
  signal.throwIfAborted();
  if (sessionFile) {
    const manager = SessionManager.open(sessionFile, sessionDir, workspaceRoot);
    installPiSessionManagerGuards(manager);
    return {
      manager,
      reusedFile: true,
    };
  }
  const manager = SessionManager.create(workspaceRoot, sessionDir);
  installPiSessionManagerGuards(manager);
  return {
    manager,
    reusedFile: false,
  };
}

/**
 * Best-effort filesystem cleanup after the SQLite session is deleted.
 * The directory may remain on disk after an error, under its old history key.
 */
export const invalidatePiSessionDir = async (
  rootDir: string,
  coworkSessionId: string,
  piHistoryKey?: string | null,
): Promise<void> => {
  const sessionDir = piSessionDirFor(rootDir, coworkSessionId, piHistoryKey);
  try {
    await removeSessionDirectory(sessionDir);
  } catch (error) {
    console.error(
      `[PiSessionStore] failed to invalidate the session directory for ${coworkSessionId}:`,
      error,
    );
  }
};
