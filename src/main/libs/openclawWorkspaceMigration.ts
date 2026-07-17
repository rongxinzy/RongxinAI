/**
 * One-time migration: move main agent workspace files from the user's
 * configured working directory to the fixed `{STATE_DIR}/workspace-main/`
 * path, so the main agent workspace is decoupled from the working directory.
 *
 * Safe to call multiple times - uses a kv flag for idempotency.
 * Never deletes source files.
 */

import fs from 'fs';
import path from 'path';

import type { SqliteStore } from '../sqliteStore';
import {
  getMainAgentWorkspacePath,
  syncMemoryFileOnWorkspaceChange,
} from './openclawMemoryFile';

const TAG = '[OpenClaw Migration]';
const MIGRATION_KEY = 'migration.mainAgentWorkspace.v3.completed';

const AGENTS_MARKER = '<!-- ZhiYuanAgent managed: do not edit below this line -->';
const BOOTSTRAP_FILES = ['IDENTITY.md', 'USER.md', 'SOUL.md', 'TOOLS.md', 'BOOTSTRAP.md'];

type CopyResult = {
  changed: boolean;
  error: boolean;
};

function mergeResult(results: CopyResult[]): CopyResult {
  return {
    changed: results.some((result) => result.changed),
    error: results.some((result) => result.error),
  };
}

function isNonEmptyFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile() && fs.readFileSync(filePath, 'utf8').trim().length > 0;
  } catch {
    return false;
  }
}

function readNonEmptyText(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

function buildConflictPath(dest: string): string {
  const parsed = path.parse(dest);
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  let candidate = path.join(parsed.dir, `${parsed.name}.migrated-${stamp}${parsed.ext}`);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(parsed.dir, `${parsed.name}.migrated-${stamp}-${index}${parsed.ext}`);
    index++;
  }
  return candidate;
}

function copyFilePreservingDestination(src: string, dest: string): CopyResult {
  try {
    const srcContent = readNonEmptyText(src);
    if (!srcContent) return { changed: false, error: false };

    if (!fs.existsSync(dest) || !isNonEmptyFile(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, srcContent, 'utf8');
      return { changed: true, error: false };
    }

    const destContent = fs.readFileSync(dest, 'utf8');
    if (destContent === srcContent) return { changed: false, error: false };

    const conflictPath = buildConflictPath(dest);
    fs.writeFileSync(conflictPath, srcContent, 'utf8');
    console.warn(`${TAG} Preserved conflicting file as ${conflictPath}`);
    return { changed: true, error: false };
  } catch (err) {
    console.warn(`${TAG} Failed to copy ${src} to ${dest}:`, err instanceof Error ? err.message : err);
    return { changed: false, error: true };
  }
}

/**
 * Copy a file from `src` to `dest` only if `src` exists and `dest` is
 * missing or empty.
 */
function copyIfNeeded(src: string, dest: string): CopyResult {
  try {
    const srcContent = readNonEmptyText(src);
    if (!srcContent) return { changed: false, error: false };

    // Don't overwrite non-empty destination
    if (isNonEmptyFile(dest)) {
      return { changed: false, error: false };
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, srcContent, 'utf8');
    return { changed: true, error: false };
  } catch (err) {
    console.warn(`${TAG} Failed to copy ${src} to ${dest}:`, err instanceof Error ? err.message : err);
    return { changed: false, error: true };
  }
}

/**
 * Recursively merge a directory without overwriting non-empty destination files.
 */
function mergeDirIfNeeded(src: string, dest: string): CopyResult {
  try {
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
      return { changed: false, error: false };
    }

    fs.mkdirSync(dest, { recursive: true });
    const results: CopyResult[] = [];
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        results.push(mergeDirIfNeeded(srcPath, destPath));
      } else if (entry.isFile()) {
        results.push(copyFilePreservingDestination(srcPath, destPath));
      }
    }
    return mergeResult(results);
  } catch (err) {
    console.warn(`${TAG} Failed to merge directory ${src} to ${dest}:`, err instanceof Error ? err.message : err);
    return { changed: false, error: true };
  }
}

function extractAgentsUserContent(content: string): string {
  const markerIndex = content.indexOf(AGENTS_MARKER);
  const userContent = markerIndex >= 0 ? content.slice(0, markerIndex) : content;
  return userContent.trim();
}

function mergeAgentsMdUserContent(src: string, dest: string): CopyResult {
  try {
    const srcContent = readNonEmptyText(src);
    if (!srcContent) return { changed: false, error: false };

    const srcUserContent = extractAgentsUserContent(srcContent);
    if (!srcUserContent) return { changed: false, error: false };

    let destContent = '';
    try {
      destContent = fs.readFileSync(dest, 'utf8');
    } catch {
      // Destination does not exist yet.
    }

    if (destContent.includes(srcUserContent)) {
      return { changed: false, error: false };
    }

    const markerIndex = destContent.indexOf(AGENTS_MARKER);
    let nextContent: string;
    if (!destContent.trim()) {
      nextContent = `${srcUserContent}\n`;
    } else if (markerIndex >= 0) {
      const destUserContent = destContent.slice(0, markerIndex).trim();
      const managedContent = destContent.slice(markerIndex).trimStart();
      nextContent = destUserContent
        ? `${destUserContent}\n\n${srcUserContent}\n\n${managedContent}`
        : `${srcUserContent}\n\n${managedContent}`;
      if (!nextContent.endsWith('\n')) nextContent += '\n';
    } else {
      nextContent = `${destContent.trimEnd()}\n\n${srcUserContent}\n`;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, nextContent, 'utf8');
    return { changed: true, error: false };
  } catch (err) {
    console.warn(`${TAG} Failed to migrate AGENTS.md user content:`, err instanceof Error ? err.message : err);
    return { changed: false, error: true };
  }
}

/**
 * Migrate main agent workspace files from the old working directory to
 * `{STATE_DIR}/workspace-main/`.
 */
export function migrateMainAgentWorkspace(
  stateDir: string,
  oldWorkingDirectory: string | undefined,
  store: SqliteStore,
): void {
  // Already completed - skip
  if (store.get<string>(MIGRATION_KEY) === '1') return;

  const oldDir = (oldWorkingDirectory || '').trim();
  const newDir = getMainAgentWorkspacePath(stateDir);

  console.log(`${TAG} Starting main agent workspace migration: ${oldDir || '(empty)'} to ${newDir}`);

  // Ensure destination exists
  try {
    fs.mkdirSync(newDir, { recursive: true });
  } catch (err) {
    console.warn(`${TAG} Failed to create destination workspace:`, err instanceof Error ? err.message : err);
    return;
  }

  // Skip if source and destination are the same path
  if (oldDir && path.resolve(oldDir) === path.resolve(newDir)) {
    console.log(`${TAG} Source and destination are identical, marking done`);
    store.set(MIGRATION_KEY, '1');
    return;
  }

  if (!oldDir) {
    console.log(`${TAG} No previous working directory configured, marking done`);
    store.set(MIGRATION_KEY, '1');
    return;
  }

  // 1. Migrate memory/ directory (daily logs)
  //    Must run BEFORE MEMORY.md sync because syncMemoryFileOnWorkspaceChange
  //    creates an empty memory/ dir as a side effect, which would cause
  //    copyDirIfNeeded to skip the copy.
  const oldMemoryDir = path.join(oldDir, 'memory');
  const newMemoryDir = path.join(newDir, 'memory');
  const results: CopyResult[] = [];
  const memoryResult = mergeDirIfNeeded(oldMemoryDir, newMemoryDir);
  results.push(memoryResult);
  if (memoryResult.changed) {
    console.log(`${TAG} Migrated memory/ directory`);
  }

  // 2. Migrate MEMORY.md via merge-dedup
  try {
    const result = syncMemoryFileOnWorkspaceChange(oldDir, newDir);
    console.log(`${TAG} MEMORY.md migration: synced=${result.synced}${result.error ? `, error=${result.error}` : ''}`);
    if (result.error) {
      results.push({ changed: false, error: true });
    }
  } catch (err) {
    console.warn(`${TAG} MEMORY.md migration failed:`, err instanceof Error ? err.message : err);
    results.push({ changed: false, error: true });
  }

  // 3. Migrate AGENTS.md user-authored content only. The managed section is
  // rebuilt by openclawConfigSync.
  const agentsResult = mergeAgentsMdUserContent(
    path.join(oldDir, 'AGENTS.md'),
    path.join(newDir, 'AGENTS.md'),
  );
  results.push(agentsResult);
  if (agentsResult.changed) {
    console.log(`${TAG} Migrated AGENTS.md user content`);
  }

  // 4. Migrate bootstrap files.
  for (const filename of BOOTSTRAP_FILES) {
    const src = path.join(oldDir, filename);
    const dest = path.join(newDir, filename);
    const result = copyIfNeeded(src, dest);
    results.push(result);
    if (result.changed) {
      console.log(`${TAG} Migrated ${filename}`);
    }
  }

  if (results.some((result) => result.error)) {
    console.warn(`${TAG} Main agent workspace migration completed with errors; it will retry on next startup`);
    return;
  }

  // Mark as completed
  store.set(MIGRATION_KEY, '1');
  console.log(`${TAG} Main agent workspace migration completed`);
}
