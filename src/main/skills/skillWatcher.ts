import { BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  SKILLS_CONFIG_FILE,
  SKILL_FILE_NAME,
  RONGX_DIR_NAME,
  WATCH_DEBOUNCE_MS,
} from './constants';

/**
 * Decides whether a filesystem event observed under a skills root affects a
 * skill definition and should trigger a debounced skills-changed notification.
 *
 * `relativePath` is the event filename relative to the watched root; `\`
 * separators are normalized to `/` (recursive fs.watch reports child paths
 * as platform-separated relative paths). `null` filenames carry no path
 * information and are handled per-platform.
 */
export function isSkillDefinitionChange(
  relativePath: string | null,
  platform: NodeJS.Platform,
): boolean {
  if (relativePath === null) {
    // On Windows, fs.watch (ReadDirectoryChangesW) frequently reports null
    // filenames for unrelated filesystem activity (AV scans, search indexing,
    // timestamp updates).  Ignoring null filenames avoids false
    // skills-changed listener chains that can trigger unwanted
    // Gateway restarts.  Legitimate skill changes always go through explicit
    // code paths (installSkill, deleteSkill, etc.) that call
    // notifySkillsChanged directly.
    return platform !== 'win32';
  }

  const segments = relativePath
    .split('\\')
    .join('/')
    .split('/')
    .filter(segment => segment.length > 0);
  if (segments.length === 0) return false;
  // Ignore hidden files/dirs (dot-prefixed caches, metadata, tombstones).
  if (segments[0].startsWith('.')) return false;

  const [first, second, third] = segments;

  // Root-level config file.
  if (segments.length === 1) {
    return first === SKILLS_CONFIG_FILE || !path.posix.extname(first);
  }

  // `<skill>/SKILL.md`, `<skill>/skills.config.json`, or the same names under
  // `<skill>/zhiyuan/`. Everything else (deeper files, caches, data files)
  // is not a definition change.
  if (segments.length === 2) {
    return second === SKILL_FILE_NAME || second === SKILLS_CONFIG_FILE;
  }
  if (segments.length === 3 && second === RONGX_DIR_NAME) {
    return third === SKILL_FILE_NAME || third === SKILLS_CONFIG_FILE;
  }
  return false;
}

/**
 * Watches the skill roots for definition-file changes and debounces
 * skills-changed notifications (browser windows + registered listeners).
 *
 * One recursive watcher per root replaces the former fan-out of one watcher
 * per skill directory (and per `.rongx` directory); a recursive watcher
 * already sees new skill directories, so watchers are no longer torn down
 * and re-created after every change.
 */
export class SkillWatcher {
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private notifyTimer: NodeJS.Timeout | null = null;
  private changeListeners: Array<() => void> = [];
  private cleanupRoots?: string[];
  private cleanupTask?: Promise<void>;
  private closed = false;

  constructor(
    private getRoots: () => string[],
    private platform: NodeJS.Platform = process.platform,
  ) {}

  startWatching(): void {
    if (this.closed) return;
    const roots = new Set(this.getRoots());
    for (const [root, watcher] of this.watchers) {
      if (roots.has(root)) continue;
      this.watchers.delete(root);
      watcher.close();
    }

    const rootWatchHandler = (_event: string, filename: string | null) => {
      if (isSkillDefinitionChange(filename, this.platform)) {
        this.scheduleNotify();
      }
    };

    for (const root of roots) {
      if (this.watchers.has(root)) continue;
      try {
        const watcher = fs.watch(root, { recursive: true }, rootWatchHandler);
        watcher.on('error', error => {
          if (this.watchers.get(root) !== watcher) return;
          this.watchers.delete(root);
          watcher.close();
          console.error('[skills] Skills root watcher error for %s:', root, error);
        });
        this.watchers.set(root, watcher);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('[skills] Failed to watch skills root:', root, error);
        }
      }
    }

    if (this.platform === 'win32') {
      this.cleanupRoots = [...roots];
      this.cleanupTask ??= Promise.resolve().then(() => this.cleanTombstones());
    }
  }

  stopWatching(): void {
    this.cleanupRoots = undefined;
    this.watchers.forEach(watcher => watcher.close());
    this.watchers.clear();
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.stopWatching();
    await this.cleanupTask;
  }

  private async cleanTombstones(): Promise<void> {
    while (this.cleanupRoots) {
      const roots = this.cleanupRoots;
      for (const root of roots) {
        if (this.cleanupRoots !== roots) break;
        try {
          for await (const entry of await fs.promises.opendir(root)) {
            if (this.cleanupRoots !== roots) break;
            if (!entry.isDirectory() || !/\.deleted\.\d+$/.test(entry.name)) continue;
            const directory = path.join(root, entry.name);
            try {
              await fs.promises.lstat(path.join(directory, SKILL_FILE_NAME));
              continue;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue;
            }
            if (this.cleanupRoots !== roots) break;
            try {
              await fs.promises.rm(directory, { recursive: true, force: true });
              console.debug('[skills] cleaned up tombstone "%s"', entry.name);
            } catch {
              // Retry when the root is watched again.
            }
          }
        } catch {
          // Roots may disappear while pending.
        }
      }
      if (this.cleanupRoots === roots) this.cleanupRoots = undefined;
    }
    this.cleanupTask = undefined;
  }

  handleWorkingDirectoryChange(): void {
    this.startWatching();
    this.notifySkillsChanged();
  }

  private scheduleNotify(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
    }
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.notifySkillsChanged();
    }, WATCH_DEBOUNCE_MS);
  }

  notifySkillsChanged(): void {
    if (this.closed) return;
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send('skills:changed');
      }
    });
    // Notify listeners that synchronize agent workspace metadata.
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (error) {
        console.warn('[skills] onSkillsChanged listener error:', error);
      }
    }
  }

  onSkillsChanged(listener: () => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter(l => l !== listener);
    };
  }
}
