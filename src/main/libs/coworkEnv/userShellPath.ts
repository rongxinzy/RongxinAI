import { execSync } from 'child_process';

/**
 * Cached user shell PATH. Resolved once and reused across calls.
 */
let cachedUserShellPath: string | null | undefined;

/**
 * Resolve the user's login shell PATH on macOS/Linux.
 * Packaged Electron apps on macOS don't inherit the user's shell profile,
 * so node/npm and other tools won't be in PATH unless we resolve it.
 */
export function resolveUserShellPath(): string | null {
  if (cachedUserShellPath !== undefined) return cachedUserShellPath;

  if (process.platform === 'win32') {
    cachedUserShellPath = null;
    return null;
  }

  try {
    const shell = process.env.SHELL || '/bin/bash';
    // Prefer non-interactive login shell first to avoid potential side effects
    // from interactive startup scripts (which may launch extra GUI processes).
    const pathProbes = [`${shell} -lc 'echo __PATH__=$PATH'`];

    let resolved: string | null = null;
    for (const probe of pathProbes) {
      try {
        const result = execSync(probe, {
          encoding: 'utf-8',
          timeout: 5000,
          env: { ...process.env },
        });
        const match = result.match(/__PATH__=(.+)/);
        if (match?.[1]) {
          resolved = match[1].trim();
          break;
        }
      } catch {
        // Try next probe.
      }
    }
    cachedUserShellPath = resolved;
  } catch (error) {
    console.warn('[coworkUtil] Failed to resolve user shell PATH:', error);
    cachedUserShellPath = null;
  }

  return cachedUserShellPath;
}
