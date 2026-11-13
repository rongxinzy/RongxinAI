import { delimiter } from 'path';

import { runCommandCapture } from '../../skills/processRunner';

/**
 * Append entries to a delimited PATH-style environment variable, dropping
 * empty entries and duplicates while keeping the first occurrence of each
 * entry (additions first, then the current value's entries).
 */
export function appendEnvPath(
  current: string | undefined,
  additions: string[],
): string | undefined {
  const items = new Set<string>();

  for (const entry of additions) {
    if (entry) {
      items.add(entry);
    }
  }

  if (current) {
    for (const entry of current.split(delimiter)) {
      if (entry) {
        items.add(entry);
      }
    }
  }

  return items.size > 0 ? Array.from(items).join(delimiter) : current;
}

/**
 * Check whether a command resolves via `which`/`where` when run with the
 * given environment. The lookup never blocks the main thread.
 */
export async function hasCommandInEnv(
  command: string,
  env: Record<string, string | undefined>,
): Promise<boolean> {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    await runCommandCapture(whichCmd, [command], {
      env: { ...env } as NodeJS.ProcessEnv,
      timeoutMs: 5000,
    });
    return true;
  } catch {
    return false;
  }
}
