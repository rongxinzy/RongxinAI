import { existsSync } from 'fs';
import { delimiter, join } from 'path';

import { coworkLog } from '../coworkLogger';

/**
 * Windows system directories that must be in PATH for built-in commands
 * (ipconfig, systeminfo, netstat, ping, nslookup, powershell, etc.) to work.
 */
const WINDOWS_SYSTEM_PATH_ENTRIES = [
  'System32',
  'System32\\Wbem',
  'System32\\WindowsPowerShell\\v1.0',
  'System32\\OpenSSH',
];

/**
 * Critical Windows environment variables that some system commands and DLLs depend on.
 * Without these, commands like ipconfig may fail even if System32 is in PATH.
 */
const WINDOWS_CRITICAL_ENV_VARS: Record<string, () => string | undefined> = {
  SystemRoot: () => process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\windows',
  windir: () =>
    process.env.windir ||
    process.env.WINDIR ||
    process.env.SystemRoot ||
    process.env.SYSTEMROOT ||
    'C:\\windows',
  COMSPEC: () => process.env.COMSPEC || process.env.comspec || 'C:\\windows\\system32\\cmd.exe',
  SYSTEMDRIVE: () => process.env.SYSTEMDRIVE || process.env.SystemDrive || 'C:',
};

/**
 * Ensure critical Windows system environment variables are present in the env object.
 * Packaged Electron apps launched from Explorer may strip or omit these variables.
 */
export function ensureWindowsSystemEnvVars(env: Record<string, string | undefined>): void {
  const injected: string[] = [];

  for (const [key, resolver] of Object.entries(WINDOWS_CRITICAL_ENV_VARS)) {
    // Check both the exact case and common variants (Windows env vars are case-insensitive
    // but Node.js process.env on Windows normalizes to the original casing)
    if (!env[key]) {
      const value = resolver();
      if (value) {
        env[key] = value;
        injected.push(`${key}=${value}`);
      }
    }
  }

  if (injected.length > 0) {
    coworkLog(
      'INFO',
      'ensureWindowsSystemEnvVars',
      `Injected missing Windows system env vars: ${injected.join(', ')}`,
    );
  }
}

/**
 * Ensure Windows system directories (System32, PowerShell, OpenSSH, etc.) are present in PATH.
 */
export function ensureWindowsSystemPathEntries(env: Record<string, string | undefined>): void {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\windows';
  const currentPath = env.PATH || '';
  const currentEntries = currentPath.split(delimiter).map(entry => entry.toLowerCase());

  const missingDirs: string[] = [];
  for (const relDir of WINDOWS_SYSTEM_PATH_ENTRIES) {
    const fullDir = join(systemRoot, relDir);
    if (!currentEntries.includes(fullDir.toLowerCase()) && existsSync(fullDir)) {
      missingDirs.push(fullDir);
    }
  }

  // Also ensure the systemRoot itself (e.g. C:\windows) is in PATH
  if (!currentEntries.includes(systemRoot.toLowerCase()) && existsSync(systemRoot)) {
    missingDirs.push(systemRoot);
  }

  if (missingDirs.length > 0) {
    // Append system dirs at the END so they don't override user tools
    env.PATH = currentPath
      ? `${currentPath}${delimiter}${missingDirs.join(delimiter)}`
      : missingDirs.join(delimiter);
    coworkLog(
      'INFO',
      'ensureWindowsSystemPathEntries',
      `Appended missing Windows system PATH entries: ${missingDirs.join(', ')}`,
    );
  }
}
