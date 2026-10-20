import { runCommandCapture } from '../../skills/processRunner';

/**
 * Cached user shell PATH promise. Resolved once and reused across calls.
 */
let cachedUserShellPathPromise: Promise<string | null> | undefined;

/**
 * Resolve the user's login shell PATH on macOS/Linux.
 * Packaged Electron apps on macOS don't inherit the user's shell profile,
 * so node/npm and other tools won't be in PATH unless we resolve it.
 */
export function resolveUserShellPath(): Promise<string | null> {
  cachedUserShellPathPromise ??= (async (): Promise<string | null> => {
    if (process.platform === 'win32') {
      return null;
    }

    try {
      const shell = process.env.SHELL || '/bin/bash';
      // Prefer non-interactive login shell first to avoid potential side effects
      // from interactive startup scripts (which may launch extra GUI processes).
      try {
        const { stdout } = await runCommandCapture(shell, ['-lc', 'echo __PATH__=$PATH'], {
          timeoutMs: 5000,
          env: { ...process.env } as NodeJS.ProcessEnv,
        });
        const match = stdout.match(/__PATH__=(.+)/);
        if (match?.[1]) {
          return match[1].trim();
        }
      } catch {
        // No fallback probe; keep the original probe list semantics.
      }
      return null;
    } catch (error) {
      console.warn('[coworkUtil] Failed to resolve user shell PATH:', error);
      return null;
    }
  })();
  return cachedUserShellPathPromise;
}
