import { execSync, spawnSync } from 'child_process';
import { app } from 'electron';

import { getElectronNodeRuntimePath } from '../libs/coworkUtil';
import { appendPythonRuntimeToEnv } from '../libs/pythonRuntime';

/**
 * Resolve the user's login shell PATH on macOS/Linux.
 * Packaged Electron apps on macOS don't inherit the user's shell profile,
 * so node/npm won't be in PATH unless we resolve it explicitly.
 */
function resolveUserShellPath(): string | null {
  if (process.platform === 'win32') return null;

  try {
    const shell = process.env.SHELL || '/bin/bash';
    // Use non-interactive login shell to avoid side effects in interactive startup scripts.
    const result = execSync(`${shell} -lc 'echo __PATH__=$PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env },
    });
    const match = result.match(/__PATH__=(.+)/);
    return match ? match[1].trim() : null;
  } catch (error) {
    console.warn('[skills] Failed to resolve user shell PATH:', error);
    return null;
  }
}

/**
 * Check if a command exists in the given environment.
 */
export function hasCommand(command: string, env: NodeJS.ProcessEnv): boolean {
  const isWin = process.platform === 'win32';
  const checker = isWin ? 'where' : 'which';
  // On Windows, use shell: true so cmd.exe resolves PATH correctly
  // (avoids issues with duplicated PATH/Path keys in env)
  const result = spawnSync(checker, [command], {
    stdio: 'pipe',
    env,
    shell: isWin,
    windowsHide: isWin,
    timeout: 5000,
  });
  if (result.status !== 0) {
    console.log(
      `[skills] hasCommand('${command}'): not found (status=${result.status}, error=${result.error?.message || 'none'})`,
    );
  }
  return result.status === 0;
}

/**
 * Normalize the PATH key in an env object on Windows.
 * Windows env vars are case-insensitive, but JS objects are case-sensitive.
 * After spreading process.env, the key might be "Path" or "PATH".
 * We normalize to "PATH" to avoid issues with duplicate keys.
 */
function normalizePathKey(env: Record<string, string | undefined>): void {
  if (process.platform !== 'win32') return;

  const pathKeys = Object.keys(env).filter(k => k.toLowerCase() === 'path');
  if (pathKeys.length <= 1) return;

  // Merge all PATH-like values (separated by ;), then remove duplicates
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const key of pathKeys) {
    const value = env[key];
    if (!value) continue;
    for (const entry of value.split(';')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const normalized = trimmed.toLowerCase().replace(/[\\/]+$/, '');
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      merged.push(trimmed);
    }
    if (key !== 'PATH') {
      delete env[key];
    }
  }
  env.PATH = merged.join(';');
}

/**
 * Resolve the latest Windows system PATH from the registry.
 * When an Electron app is launched from Start Menu or Explorer,
 * process.env.PATH may be stale (missing tools installed after Explorer started).
 */
function resolveWindowsRegistryPath(): string | null {
  if (process.platform !== 'win32') return null;

  try {
    const machinePath = execSync(
      'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path',
      { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    );
    const userPath = execSync('reg query "HKCU\\Environment" /v Path', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });

    const extract = (output: string): string => {
      const match = output.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
      return match ? match[1].trim() : '';
    };

    const combined = [extract(machinePath), extract(userPath)].filter(Boolean).join(';');
    return combined || null;
  } catch {
    return null;
  }
}

/**
 * Build an environment for spawning skill scripts.
 * Merges the user's shell PATH with the current process environment.
 */
export function buildSkillEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };

  // Normalize PATH key casing on Windows to avoid duplicate PATH/Path issues
  normalizePathKey(env);

  // Ensure HOME is available for skill subprocesses that persist state
  // under the user's home directory instead of resolving to the filesystem root.
  if (!env.HOME) {
    env.HOME = app.getPath('home');
    console.debug('[skills] HOME was unset; using Electron user home directory');
  }
  if (process.platform === 'win32' && !env.USERPROFILE) {
    env.USERPROFILE = env.HOME;
    console.debug('[skills] USERPROFILE was unset; aligned with HOME for skill subprocesses');
  }

  if (app.isPackaged) {
    if (process.platform === 'win32') {
      // On Windows, merge the latest PATH from the registry to pick up
      // tools installed after the Electron app (or Explorer) was started.
      const registryPath = resolveWindowsRegistryPath();
      if (registryPath) {
        const currentPath = env.PATH || '';
        const seen = new Set(
          currentPath
            .toLowerCase()
            .split(';')
            .map(s => s.trim().replace(/[\\/]+$/, ''))
            .filter(Boolean),
        );
        const extra: string[] = [];
        for (const entry of registryPath.split(';')) {
          const trimmed = entry.trim();
          if (!trimmed) continue;
          const key = trimmed.toLowerCase().replace(/[\\/]+$/, '');
          if (!seen.has(key)) {
            seen.add(key);
            extra.push(trimmed);
          }
        }
        if (extra.length > 0) {
          env.PATH = currentPath ? `${currentPath};${extra.join(';')}` : extra.join(';');
          console.log('[skills] Merged registry PATH entries for skill scripts');
        }
      }

      // Append common Windows Node.js installation paths as fallback
      const commonWinPaths = [
        'C:\\Program Files\\nodejs',
        'C:\\Program Files (x86)\\nodejs',
        `${env.APPDATA || ''}\\npm`,
        `${env.LOCALAPPDATA || ''}\\Programs\\nodejs`,
      ].filter(Boolean);

      const pathSet = new Set(
        (env.PATH || '')
          .toLowerCase()
          .split(';')
          .map(s => s.trim().replace(/[\\/]+$/, '')),
      );
      const missingPaths = commonWinPaths.filter(
        p => !pathSet.has(p.toLowerCase().replace(/[\\/]+$/, '')),
      );
      if (missingPaths.length > 0) {
        env.PATH = env.PATH ? `${env.PATH};${missingPaths.join(';')}` : missingPaths.join(';');
      }
    } else {
      // Resolve user's shell PATH to find npm/node (macOS/Linux)
      const userPath = resolveUserShellPath();
      if (userPath) {
        env.PATH = userPath;
        console.log('[skills] Resolved user shell PATH for skill scripts');
      } else {
        // Fallback: append common node installation paths
        const commonPaths = [
          '/usr/local/bin',
          '/opt/homebrew/bin',
          `${env.HOME}/.nvm/current/bin`,
          `${env.HOME}/.volta/bin`,
          `${env.HOME}/.fnm/current/bin`,
        ];
        env.PATH = [env.PATH, ...commonPaths].filter(Boolean).join(':');
        console.log('[skills] Using fallback PATH for skill scripts');
      }
    }
  }

  // Expose Electron executable so skill scripts can run JS with ELECTRON_RUN_AS_NODE
  // even when system Node.js is not installed.
  env.ZHIYUAN_ELECTRON_PATH = getElectronNodeRuntimePath();
  appendPythonRuntimeToEnv(env);

  // Re-normalize after appendPythonRuntimeToEnv may have added a PATH key
  normalizePathKey(env);

  return env;
}
