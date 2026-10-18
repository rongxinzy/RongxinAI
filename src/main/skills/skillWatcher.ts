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
  private watchers: fs.FSWatcher[] = [];
  private notifyTimer: NodeJS.Timeout | null = null;
  private changeListeners: Array<() => void> = [];

  constructor(private getRoots: () => string[]) {}

  startWatching(): void {
    this.stopWatching();
    const roots = this.getRoots();

    // Clean up tombstone directories left by failed deletions on Windows
    if (process.platform === 'win32') {
      for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        try {
          for (const entry of fs.readdirSync(root)) {
            if (/\.deleted\.\d+$/.test(entry)) {
              try {
                fs.rmSync(path.join(root, entry), { recursive: true, force: true });
                console.log('[skills] startWatching: cleaned up tombstone "%s"', entry);
              } catch {
                /* will retry next time */
              }
            }
          }
        } catch {
          /* ignore scan errors */
        }
      }
    }

    const rootWatchHandler = (_event: string, filename: string | null) => {
      if (isSkillDefinitionChange(filename, process.platform)) {
        this.scheduleNotify();
      }
    };

    roots.forEach(root => {
      if (!fs.existsSync(root)) return;
      try {
        const watcher = fs.watch(root, { recursive: true }, rootWatchHandler);
        watcher.on('error', error => {
          // Watching a deleted/unavailable root must never crash main.
          console.error('[skills] Skills root watcher error for %s:', root, error);
        });
        this.watchers.push(watcher);
      } catch (error) {
        console.warn('[skills] Failed to watch skills root:', root, error);
      }
    });
  }

  stopWatching(): void {
    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
    }
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
