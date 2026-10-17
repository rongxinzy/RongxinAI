import { spawnSync } from 'child_process';
import { delimiter } from 'path';

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
 * given environment.
 */
export function hasCommandInEnv(command: string, env: Record<string, string | undefined>): boolean {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(whichCmd, [command], {
      env: { ...env } as NodeJS.ProcessEnv,
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: process.platform === 'win32',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Normalize a Windows path reported by `where`/registry queries: trim
 * whitespace and carriage returns, strip surrounding quotes, and convert
 * forward slashes to backslashes.
 */
export function normalizeWindowsPath(input: string | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().replace(/\r/g, '');
  if (!trimmed) return null;

  const unquoted = trimmed.replace(/^["']+|["']+$/g, '');
  if (!unquoted) return null;

  return unquoted.replace(/\//g, '\\');
}

/**
 * Convert a single Windows path to MSYS2/POSIX format.
 *
 * When the Windows path contains non-ASCII characters (e.g. Chinese usernames
 * like C:\Users\中文用户\...), MSYS2's automatic Windows→POSIX conversion may
 * corrupt the path if it runs before LANG=C.UTF-8 takes effect. Pre-converting
 * to POSIX format (/c/Users/中文用户/...) bypasses this problematic conversion
 * because MSYS2 recognises the value as already POSIX and passes it through
 * directly to its internal wide-char file APIs.
 */
export function singleWindowsPathToPosix(windowsPath: string): string {
  if (!windowsPath) return windowsPath;
  const driveMatch = windowsPath.match(/^([A-Za-z]):[/\\](.*)/);
  if (driveMatch) {
    const driveLetter = driveMatch[1].toLowerCase();
    const rest = driveMatch[2].replace(/\\/g, '/').replace(/\/+$/, '');
    return `/${driveLetter}${rest ? '/' + rest : ''}`;
  }
  return windowsPath.replace(/\\/g, '/');
}

/**
 * Convert a Windows-format PATH string to MSYS2/POSIX format for git-bash.
 *
 * Windows PATH uses semicolons (;) as delimiters and backslash paths (C:\...),
 * while MSYS2 bash expects colons (:) and forward-slash POSIX paths (/c/...).
 *
 * When Node.js passes env vars to a forked process, PATH stays in Windows format.
 * If the CLI later spawns git-bash, the /etc/profile uses ORIGINAL_PATH="${PATH}"
 * and appends it to the new PATH with a colon. But since the Windows PATH still
 * has semicolons inside, it becomes one giant invalid path entry.
 *
 * This function converts each semicolon-separated Windows path entry to its
 * POSIX equivalent so that git-bash can correctly parse all entries.
 */
export function convertWindowsPathToMsys(windowsPath: string): string {
  if (!windowsPath) return windowsPath;

  const entries = windowsPath.split(';').filter(Boolean);
  const converted: string[] = [];

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    // Convert Windows path to POSIX: C:\foo\bar → /c/foo/bar
    // Drive letter pattern: X:\ or X:/
    const driveMatch = trimmed.match(/^([A-Za-z]):[/\\](.*)/);
    if (driveMatch) {
      const driveLetter = driveMatch[1].toLowerCase();
      const rest = driveMatch[2].replace(/\\/g, '/').replace(/\/+$/, '');
      converted.push(`/${driveLetter}${rest ? '/' + rest : ''}`);
    } else if (trimmed.startsWith('/')) {
      // Already POSIX-style
      converted.push(trimmed);
    } else {
      // Relative path or unknown format, convert backslashes
      converted.push(trimmed.replace(/\\/g, '/'));
    }
  }

  return converted.join(':');
}

/**
 * Truncate a diagnostic message for logs and env-var diagnostics.
 */
export function truncateDiagnostic(message: string, maxLength = 500): string {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength - 3)}...`;
}
