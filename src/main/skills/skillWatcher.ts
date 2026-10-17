import { BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  SKILLS_CONFIG_FILE,
  SKILL_FILE_NAME,
  RONGX_DIR_NAME,
  WATCH_DEBOUNCE_MS,
} from './constants';
import { listSkillDirs } from './skillDirs';

/**
 * Watches the skill roots for definition-file changes and debounces
 * skills-changed notifications (browser windows + registered listeners).
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

    // Root-level watch: only react to directory additions/removals (new/deleted skills).
    const rootWatchHandler = (_event: string, filename: string | null) => {
      // On Windows, fs.watch (ReadDirectoryChangesW) frequently reports null
      // filenames for unrelated filesystem activity (AV scans, search indexing,
      // timestamp updates).  Ignoring null filenames avoids false
      // skills-changed listener chains that can trigger unwanted
      // Gateway restarts.  Legitimate skill changes always go through explicit
      // code paths (installSkill, deleteSkill, etc.) that call
      // notifySkillsChanged directly.
      if (!filename) {
        if (process.platform !== 'win32') this.scheduleNotify();
        return;
      }
      // Ignore hidden files/dirs and known non-skill files
      if (filename.startsWith('.')) return;
      // Accept directory changes (new skill added/removed) and config file
      if (filename === SKILLS_CONFIG_FILE) {
        this.scheduleNotify();
        return;
      }
      // For other filenames, check if it looks like a skill directory entry
      // (no extension = likely a directory name)
      if (!path.extname(filename)) {
        this.scheduleNotify();
      }
    };

    // Skill-directory-level watch: only react to skill definition file changes.
    const skillDirWatchHandler = (_event: string, filename: string | null) => {
      if (!filename) {
        if (process.platform !== 'win32') this.scheduleNotify();
        return;
      }
      if (filename === SKILL_FILE_NAME || filename === SKILLS_CONFIG_FILE) {
        this.scheduleNotify();
      }
      // Ignore cache files, data files, and any other non-definition files.
    };

    roots.forEach(root => {
      if (!fs.existsSync(root)) return;
      try {
        this.watchers.push(fs.watch(root, rootWatchHandler));
      } catch (error) {
        console.warn('[skills] Failed to watch skills root:', root, error);
      }

      const skillDirs = listSkillDirs(root);
      skillDirs.forEach(dir => {
        try {
          this.watchers.push(fs.watch(dir, skillDirWatchHandler));
        } catch (error) {
          console.warn('[skills] Failed to watch skill directory:', dir, error);
        }

        const rongxDir = path.join(dir, RONGX_DIR_NAME);
        if (!fs.existsSync(rongxDir)) return;
        try {
          this.watchers.push(fs.watch(rongxDir, skillDirWatchHandler));
        } catch (error) {
          console.warn('[skills] Failed to watch skill UI metadata directory:', rongxDir, error);
        }
      });
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
      this.startWatching();
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
