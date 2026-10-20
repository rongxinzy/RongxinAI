import { delimiter } from 'path';

import { runCommandCapture } from '../../skills/processRunner';
import { coworkLog } from '../coworkLogger';

/**
 * Cached Windows registry PATH promise. Resolved once and reused.
 */
let cachedWindowsRegistryPathPromise: Promise<string | null> | undefined;

async function readWindowsRegistryPathValue(registryKey: string): Promise<string> {
  try {
    const { stdout } = await runCommandCapture('reg', ['query', registryKey, '/v', 'Path'], {
      timeoutMs: 8000,
    });
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/^\s*Path\s+REG_\w+\s+(.+)$/i);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
  } catch {
    // Ignore missing keys or access-denied errors.
  }

  return '';
}

/**
 * Resolve the latest PATH from the Windows registry (Machine + User).
 *
 * When a packaged Electron app is launched from the Start Menu, desktop shortcut,
 * or Explorer, its `process.env.PATH` is inherited from the Explorer shell process.
 * If the user installed tools (Python, Node.js, npm, etc.) after Explorer started
 * — or without restarting Explorer — those new PATH entries won't be in
 * `process.env.PATH`. This causes commands like `python`, `npm`, `pip` to be
 * missing from the cowork session even though they work fine in a freshly opened
 * terminal (which reads the latest registry values).
 *
 * This function reads the current Machine and User PATH directly from the registry
 * to get the most up-to-date values, similar to how `resolveUserShellPath()` works
 * for macOS/Linux.
 */
function resolveWindowsRegistryPath(): Promise<string | null> {
  cachedWindowsRegistryPathPromise ??= (async (): Promise<string | null> => {
    if (process.platform !== 'win32') {
      return null;
    }

    try {
      const machinePath = await readWindowsRegistryPathValue(
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
      );
      const userPath = await readWindowsRegistryPathValue('HKCU\\Environment');
      const registryPath = [machinePath, userPath].filter(Boolean).join(';');
      if (registryPath.trim()) {
        // Deduplicate and remove empty entries
        const entries = registryPath
          .split(';')
          .map(entry => entry.trim())
          .filter(Boolean);
        const unique = Array.from(new Set(entries));
        coworkLog(
          'INFO',
          'resolveWindowsRegistryPath',
          `Resolved ${unique.length} PATH entries from Windows registry`,
        );
        return unique.join(';');
      }
      return null;
    } catch (error) {
      coworkLog(
        'WARN',
        'resolveWindowsRegistryPath',
        `Failed to read PATH from Windows registry: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  })();
  return cachedWindowsRegistryPathPromise;
}

/**
 * Merge the current process PATH with registry-resolved PATH on Windows.
 *
 * This ensures that any PATH entries the user has added (e.g. Python, Node.js,
 * npm, pip) are available even if the Electron app inherited a stale PATH from
 * Explorer. The registry PATH entries are appended after the current entries
 * so that any overrides already in the env (like Git toolchain, shims) take priority.
 */
export async function ensureWindowsRegistryPathEntries(
  env: Record<string, string | undefined>,
): Promise<void> {
  const registryPath = await resolveWindowsRegistryPath();
  if (!registryPath) return;

  const currentPath = env.PATH || '';
  const currentEntriesLower = new Set(
    currentPath.split(delimiter).map(entry => entry.toLowerCase().replace(/\\$/, '')),
  );

  const missingEntries: string[] = [];
  for (const entry of registryPath.split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    // Normalize: remove trailing backslash for comparison
    const normalizedLower = trimmed.toLowerCase().replace(/\\$/, '');
    if (!currentEntriesLower.has(normalizedLower)) {
      missingEntries.push(trimmed);
      currentEntriesLower.add(normalizedLower); // prevent duplicates within registry entries
    }
  }

  if (missingEntries.length > 0) {
    // Append registry entries at the END so existing overrides (Git, shims) take priority
    env.PATH = currentPath
      ? `${currentPath}${delimiter}${missingEntries.join(delimiter)}`
      : missingEntries.join(delimiter);
    coworkLog(
      'INFO',
      'ensureWindowsRegistryPathEntries',
      `Appended ${missingEntries.length} missing PATH entries from Windows registry: ${missingEntries.join(', ')}`,
    );
  }
}
