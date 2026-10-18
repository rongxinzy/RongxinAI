/**
 * Async workspace snapshot for artifact diffing.
 *
 * Walks the workspace with fs.promises (never the main-thread sync APIs),
 * skipping directories and files that can never be collectible artifacts.
 * Pure data: the recorder owns the diff and recording policy.
 */
import { promises as fs } from 'fs';
import path from 'path';
import type { Stats } from 'fs';

import { getArtifactTypeByExtension } from '../../shared/cowork/artifactPreview';
import { normalizeArtifactKeyPath } from './artifactLedger';

/** Files are capped so a huge monorepo cannot stall diffing. */
const WORKSPACE_SNAPSHOT_MAX_FILES = 20_000;
const WORKSPACE_SNAPSHOT_MAX_DEPTH = 12;

/** Directories that never contain deliverables and are expensive to walk. */
const SNAPSHOT_SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);

interface WorkspaceSnapshotEntry {
  /** Absolute path with unified separators. */
  path: string;
  mtimeMs: number;
}

export interface WorkspaceSnapshot {
  /** Entries keyed by normalized path (the ledger artifact key suffix). */
  byKey: Map<string, WorkspaceSnapshotEntry>;
  /** True when file/depth caps were hit; diffs must be skipped then. */
  truncated: boolean;
}

interface PendingDir {
  dir: string;
  depth: number;
}

export interface WorkspaceSnapshotOptions {
  signal?: AbortSignal;
  /** Override the file cap (tests); defaults to WORKSPACE_SNAPSHOT_MAX_FILES. */
  maxFiles?: number;
  /** Override the depth cap (tests); defaults to WORKSPACE_SNAPSHOT_MAX_DEPTH. */
  maxDepth?: number;
}

/**
 * Snapshot all potentially-artifact files under `root`. Returns `null` when
 * the root does not exist or cannot be read. Symlinks are never followed.
 */
export async function takeWorkspaceSnapshot(
  root: string,
  options: WorkspaceSnapshotOptions = {},
): Promise<WorkspaceSnapshot | null> {
  const { signal } = options;
  const maxFiles = options.maxFiles ?? WORKSPACE_SNAPSHOT_MAX_FILES;
  const maxDepth = options.maxDepth ?? WORKSPACE_SNAPSHOT_MAX_DEPTH;
  if (!root) return null;
  try {
    const rootStat = await fs.stat(root);
    if (!rootStat.isDirectory()) return null;
  } catch {
    return null;
  }
  if (signal?.aborted) return null;
  const byKey = new Map<string, WorkspaceSnapshotEntry>();
  let truncated = false;
  let stop = false;
  const statBatch: string[] = [];

  const recordFile = (filePath: string, mtimeMs: number): void => {
    const unified = filePath.replace(/\\/g, '/');
    byKey.set(normalizeArtifactKeyPath(unified), { path: unified, mtimeMs });
  };

  const flushStats = async (): Promise<void> => {
    const paths = statBatch.splice(0, statBatch.length);
    const stats = await Promise.all(
      paths.map((entry): Promise<Stats | null> => fs.stat(entry).catch((): null => null)),
    );
    stats.forEach((stat: Stats | null, index: number) => {
      if (stat?.isFile()) recordFile(paths[index], stat.mtimeMs);
    });
  };

  const pending: PendingDir[] = [{ dir: root, depth: 0 }];
  while (pending.length > 0 && !stop) {
    if (signal?.aborted) return null;
    const { dir, depth } = pending.shift() as PendingDir;
    let dirents: import('fs').Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (byKey.size + statBatch.length >= maxFiles) {
        truncated = true;
        stop = true;
        break;
      }
      if (dirent.isSymbolicLink()) continue;
      const entryPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (SNAPSHOT_SKIPPED_DIRECTORIES.has(dirent.name)) continue;
        if (depth + 1 > maxDepth) {
          truncated = true;
          continue;
        }
        pending.push({ dir: entryPath, depth: depth + 1 });
        continue;
      }
      if (!dirent.isFile()) continue;
      if (!getArtifactTypeByExtension(dirent.name)) continue;
      statBatch.push(entryPath);
    }
    if (statBatch.length >= 256) await flushStats();
  }
  if (statBatch.length > 0) await flushStats();

  return { byKey, truncated };
}
