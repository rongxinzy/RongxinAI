/**
 * Windows resolves a process's taskbar name and icon through the Start Menu
 * shortcut that claims the same AppUserModelID. A leftover development
 * shortcut that points at a bare `electron.exe` wins that lookup and the
 * packaged app shows Electron's atom icon and "Electron" label instead of the
 * product identity. This module decides which shortcuts are such leftovers.
 */
import path from 'path';

const UNPACKAGED_ELECTRON_BASENAME = 'electron.exe';

export type StartMenuShortcut = {
  shortcutPath: string;
  appUserModelId?: string;
  target?: string;
};

export type StaleShortcutQuery = {
  execPath: string;
  appUserModelIds: readonly string[];
};

const normalizeWindowsPath = (value: string): string =>
  path.win32
    .normalize(value)
    .replace(/[\\/]+$/, '')
    .toLowerCase();

const isUnpackagedElectronBinary = (target: string): boolean =>
  path.win32.basename(target).toLowerCase() === UNPACKAGED_ELECTRON_BASENAME;

/**
 * Returns shortcuts that claim one of the app's own AppUserModelIDs while
 * launching a bare Electron binary other than the current executable. The
 * current executable is kept so the development shortcut stays in place.
 */
export const findStaleTaskbarShortcuts = (
  shortcuts: readonly StartMenuShortcut[],
  { execPath, appUserModelIds }: StaleShortcutQuery,
): StartMenuShortcut[] => {
  const managedIds = new Set(appUserModelIds);
  const currentExecPath = normalizeWindowsPath(execPath);

  return shortcuts.filter(shortcut => {
    const { appUserModelId, target } = shortcut;
    if (!appUserModelId || !managedIds.has(appUserModelId)) return false;
    if (!target) return false;
    if (normalizeWindowsPath(target) === currentExecPath) return false;
    return isUnpackagedElectronBinary(target);
  });
};
