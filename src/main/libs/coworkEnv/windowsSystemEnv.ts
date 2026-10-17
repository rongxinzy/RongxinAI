import { app } from 'electron';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { delimiter, join } from 'path';

import { coworkLog } from '../coworkLogger';
import { convertWindowsPathToMsys } from './pathUtils';

/**
 * Windows system directories that must be in PATH for built-in commands
 * (ipconfig, systeminfo, netstat, ping, nslookup, etc.) to work.
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
 *
 * Packaged Electron apps or certain launch contexts may strip environment variables
 * like SystemRoot, windir, COMSPEC, and SYSTEMDRIVE. Many Windows system commands
 * and DLLs depend on these variables to locate system resources.
 *
 * Additionally, the Claude Agent SDK's shell snapshot mechanism runs `echo $PATH`
 * via `shell: true`, which on Windows uses cmd.exe. The captured PATH is then
 * baked into the snapshot file. If these critical variables are missing, the shell
 * environment may be broken and commands fail silently.
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
 * Ensure Windows system directories (System32, etc.) are present in PATH.
 *
 * When the Electron app launches, process.env.PATH normally includes System32.
 * However, the Claude Agent SDK creates a "shell snapshot" by running git-bash
 * with `-c -l` (login shell). The git-bash `/etc/profile` rebuilds PATH based on
 * MSYS2_PATH_TYPE (default: "inherit"), which preserves ORIGINAL_PATH from the
 * inherited environment. If System32 entries are somehow missing from the inherited
 * PATH, they won't appear in the snapshot either.
 *
 * This function ensures that essential Windows system directories are always
 * present in PATH before the environment is handed to the SDK.
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

/**
 * Ensure non-login git-bash invocations can resolve core MSYS commands.
 *
 * Claude Agent SDK invokes `cygpath` during Windows path normalization via
 * `execSync(..., { shell: bash.exe })`, which does NOT always run a login shell.
 * In that code path, bash may inherit Windows-format PATH directly, and command
 * lookup for `cygpath` can fail because PATH is semicolon-delimited.
 *
 * Prefixing PATH with `/usr/bin:/bin` keeps Windows PATH semantics (semicolon
 * delimiter) while giving bash a valid colon-delimited segment at the beginning.
 * This prevents errors like: `/bin/bash: line 1: cygpath: command not found`.
 */
export function ensureWindowsBashBootstrapPath(env: Record<string, string | undefined>): void {
  const currentPath = env.PATH || '';
  if (!currentPath) return;

  const bootstrapToken = '/usr/bin:/bin';
  const entries = currentPath
    .split(delimiter)
    .map(entry => entry.trim())
    .filter(Boolean);
  if (entries.some(entry => entry === bootstrapToken)) {
    return;
  }

  env.PATH = `${bootstrapToken}${delimiter}${currentPath}`;
  coworkLog(
    'INFO',
    'ensureWindowsBashBootstrapPath',
    `Prepended bash bootstrap PATH token: ${bootstrapToken}`,
  );
}

/**
 * Set ORIGINAL_PATH with POSIX-converted PATH for git-bash to inherit.
 *
 * Git-bash's /etc/profile (with MSYS2_PATH_TYPE=inherit) reads ORIGINAL_PATH
 * and appends it to the MSYS2 PATH. However, if ORIGINAL_PATH contains
 * Windows-format paths (semicolons, backslashes), bash treats them as a single
 * invalid entry because it uses colons as the PATH delimiter.
 *
 * By pre-setting ORIGINAL_PATH to the POSIX-converted version of our PATH,
 * we ensure that /etc/profile appends properly formatted, colon-separated
 * paths that bash can actually use.
 */
export function ensureWindowsOriginalPath(env: Record<string, string | undefined>): void {
  const currentPath = env.PATH || '';
  if (!currentPath) return;

  const posixPath = convertWindowsPathToMsys(currentPath);
  env.ORIGINAL_PATH = posixPath;
  coworkLog(
    'INFO',
    'ensureWindowsOriginalPath',
    `Set ORIGINAL_PATH with ${posixPath.split(':').length} POSIX-format entries`,
  );
}

/**
 * Create a bash init script that sets the Windows console code page to UTF-8 (65001).
 *
 * On Chinese Windows, the default console code page is GBK (936). When git-bash
 * executes Windows native commands (dir, ipconfig, systeminfo, net, type, etc.),
 * they output text encoded in the active console code page. If the code page is GBK,
 * the output contains GBK-encoded bytes, but the Claude Agent SDK reads them as UTF-8,
 * producing garbled characters (mojibake).
 *
 * By setting BASH_ENV to this script, every non-interactive bash session spawned by
 * the Claude Agent SDK will automatically switch the console code page to UTF-8
 * before executing any commands.
 */
export function ensureWindowsBashUtf8InitScript(): string | null {
  try {
    const initDir = join(app.getPath('userData'), 'cowork', 'bin');
    mkdirSync(initDir, { recursive: true });

    const initScript = join(initDir, 'bash_utf8_init.sh');
    const content = [
      '#!/usr/bin/env bash',
      '# Auto-generated by ZhiYuanAgent – switch Windows console code page to UTF-8',
      '# to prevent garbled output from Windows native commands.',
      'if command -v chcp.com >/dev/null 2>&1; then',
      '  chcp.com 65001 >/dev/null 2>&1',
      'fi',
      '',
    ].join('\n');

    writeFileSync(initScript, content, 'utf8');
    try {
      chmodSync(initScript, 0o755);
    } catch {
      // Ignore chmod errors on file systems that do not support POSIX modes.
    }

    return initScript;
  } catch (error) {
    coworkLog(
      'WARN',
      'ensureWindowsBashUtf8InitScript',
      `Failed to create bash UTF-8 init script: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
