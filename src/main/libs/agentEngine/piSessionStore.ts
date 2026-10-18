/**
 * File-backed Pi session persistence.
 *
 * One Pi session directory per Cowork session under
 * `<userData>/pi-sessions/<coworkSessionId>/`. A persisted SessionManager
 * keeps the structured transcript (tool calls/results, images, thinking) in
 * Pi's JSONL, so a rebuild — app restart, idle eviction, model/skills/MCP
 * topology recreation — reopens that file and continues with structured
 * history instead of flattening the SQLite transcript into one text prompt.
 *
 * The SQLite transcript stays the UI source of truth; the JSONL exists only
 * to restore the model context. Any mutation that makes the JSONL diverge
 * from the transcript (message removal, history rewrite, transcript clear)
 * must invalidate the directory (`invalidatePiSessionDir`) so the next turn
 * falls back to the one-shot text restore and starts a fresh file.
 */

import fs from 'fs';
import path from 'path';

/** Directory under userData holding every session's Pi JSONL. */
export const PI_SESSIONS_ROOT_DIR = 'pi-sessions';

/** Computes a Cowork session's Pi session directory. */
export const piSessionDirFor = (rootDir: string, coworkSessionId: string): string =>
  path.join(rootDir, PI_SESSIONS_ROOT_DIR, coworkSessionId);

/** True when the directory holds at least one Pi session file. */
export const hasPersistedPiSession = (sessionDir: string): boolean => {
  try {
    return fs
      .readdirSync(sessionDir)
      .some(entry => entry.endsWith('.jsonl') && fs.statSync(path.join(sessionDir, entry)).isFile());
  } catch {
    return false;
  }
};

/** Lists the `.jsonl` session files in a directory (empty when unreadable). */
const listSessionFiles = (sessionDir: string): string[] => {
  try {
    return fs
      .readdirSync(sessionDir)
      .filter(entry => entry.endsWith('.jsonl'))
      .map(entry => path.join(sessionDir, entry))
      .filter(file => fs.statSync(file).isFile());
  } catch {
    return [];
  }
};

export interface PiSessionStoreFileResolution {
  /** Directory passed to the SessionManager; drives where new files land. */
  sessionDir: string;
  /** A `.jsonl` file to reopen, or null when the session must start fresh. */
  sessionFile: string | null;
}

/**
 * Resolves what the SessionManager should open for one Cowork session.
 *
 * A directory holds at most one file: sessions are recreated, never forked in
 * place. Multiple files (manual copy, crashed rewrite) resolve to the most
 * recently modified one, which matches `findMostRecentSession`'s selection.
 */
export const resolvePiSessionStoreFile = (
  rootDir: string,
  coworkSessionId: string,
): PiSessionStoreFileResolution => {
  const sessionDir = piSessionDirFor(rootDir, coworkSessionId);
  const files = listSessionFiles(sessionDir);
  if (files.length === 0) return { sessionDir, sessionFile: null };
  const newest = files.reduce((left, right) =>
    fs.statSync(left).mtimeMs >= fs.statSync(right).mtimeMs ? left : right,
  );
  return { sessionDir, sessionFile: newest };
};

export type PiSessionManagerModule = {
  create(cwd: string, sessionDir?: string, options?: { id?: string }): unknown;
  open(
    sessionFile: string,
    sessionDir?: string,
    cwdOverride?: string,
  ): unknown;
};

/**
 * Builds the persistent SessionManager the adapter hands to Pi.
 *
 * `cwdOverride` is required when reopening: Pi's `open` would otherwise use
 * the cwd recorded in the file header, which follows the workspace the file
 * was created in, not the one this rebuild runs under.
 */
export const openPersistentPiSessionManager = (
  SessionManager: PiSessionManagerModule,
  rootDir: string,
  coworkSessionId: string,
  workspaceRoot: string,
): { manager: unknown; reusedFile: boolean; sessionDir: string } => {
  const { sessionDir, sessionFile } = resolvePiSessionStoreFile(rootDir, coworkSessionId);
  if (sessionFile) {
    return {
      manager: SessionManager.open(sessionFile, sessionDir, workspaceRoot),
      reusedFile: true,
      sessionDir,
    };
  }
  return {
    manager: SessionManager.create(workspaceRoot, sessionDir, { id: coworkSessionId }),
    reusedFile: false,
    sessionDir,
  };
};

/**
 * Removes a Cowork session's Pi session directory so the next turn cannot
 * restore from a JSONL that no longer matches the SQLite transcript.
 * Missing directories are a no-op; failures leave the file in place and the
 * next turn still reopens it (worst case: stale context, never a crash).
 */
export const invalidatePiSessionDir = (rootDir: string, coworkSessionId: string): void => {
  const sessionDir = piSessionDirFor(rootDir, coworkSessionId);
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  } catch (error) {
    console.error(
      `[PiRuntime] failed to invalidate the session directory for ${coworkSessionId}:`,
      error,
    );
  }
};
