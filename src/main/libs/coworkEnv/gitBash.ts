import { execSync, spawnSync } from 'child_process';
import { app } from 'electron';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

import { coworkLog } from '../coworkLogger';
import { normalizeWindowsPath, truncateDiagnostic } from './pathUtils';

/**
 * Cached git-bash path on Windows. Resolved once and reused.
 */
let cachedGitBashPath: string | null | undefined;
let cachedGitBashResolutionError: string | null | undefined;

function listWindowsCommandPaths(command: string): string[] {
  try {
    const output = execSync(command, { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    const parsed = output
      .split(/\r?\n/)
      .map(line => normalizeWindowsPath(line))
      .filter((line): line is string => Boolean(line && existsSync(line)));
    return Array.from(new Set(parsed));
  } catch {
    return [];
  }
}

function listGitInstallPathsFromRegistry(): string[] {
  const registryKeys = [
    'HKCU\\Software\\GitForWindows',
    'HKLM\\Software\\GitForWindows',
    'HKLM\\Software\\WOW6432Node\\GitForWindows',
  ];

  const installRoots: string[] = [];

  for (const key of registryKeys) {
    try {
      const output = execSync(`reg query "${key}" /v InstallPath`, {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
      });
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(/InstallPath\s+REG_\w+\s+(.+)$/i);
        const root = normalizeWindowsPath(match?.[1]);
        if (root) {
          installRoots.push(root);
        }
      }
    } catch {
      // registry key might not exist
    }
  }

  return Array.from(new Set(installRoots));
}

function getBundledGitBashCandidates(): string[] {
  const bundledRoots = app.isPackaged
    ? [join(process.resourcesPath, 'mingit')]
    : [
        join(__dirname, '..', '..', '..', 'resources', 'mingit'),
        join(process.cwd(), 'resources', 'mingit'),
      ];

  const candidates: string[] = [];
  for (const root of bundledRoots) {
    // Prefer bin/bash.exe on Windows; invoking usr/bin/bash.exe directly may miss Git toolchain PATH.
    candidates.push(join(root, 'bin', 'bash.exe'));
    candidates.push(join(root, 'usr', 'bin', 'bash.exe'));
  }

  return candidates;
}

export function checkWindowsGitBashHealth(bashPath: string): { ok: boolean; reason?: string } {
  try {
    if (!existsSync(bashPath)) {
      return { ok: false, reason: 'path does not exist' };
    }

    // Use a minimal env for the health check to avoid interference from
    // BASH_ENV, MSYS2_PATH_TYPE, or other env vars that could slow startup.
    // Only pass PATH + SYSTEMROOT (required for Windows DLL loading) + HOME.
    const healthEnv: Record<string, string> = {
      PATH: process.env.PATH || '',
      SYSTEMROOT: process.env.SYSTEMROOT || process.env.SystemRoot || 'C:\\Windows',
      HOME: process.env.HOME || process.env.USERPROFILE || '',
    };

    // Try non-login shell first (-c instead of -lc) for speed.
    // Login shells source /etc/profile which can be slow on some systems.
    // cygpath is a standalone binary and does not require a login shell.
    const fastResult = spawnSync(bashPath, ['-c', 'cygpath -u "C:\\\\Windows"'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
      env: healthEnv,
    });

    const result =
      fastResult.error || (typeof fastResult.status === 'number' && fastResult.status !== 0)
        ? // Non-login shell failed — retry with login shell and a longer timeout.
          // Some Git Bash builds require login shell to set up PATH for cygpath.
          spawnSync(bashPath, ['-lc', 'cygpath -u "C:\\\\Windows"'], {
            encoding: 'utf-8',
            timeout: 15000,
            windowsHide: true,
            env: healthEnv,
          })
        : fastResult;

    if (result.error) {
      return { ok: false, reason: result.error.message };
    }

    if (typeof result.status === 'number' && result.status !== 0) {
      const stderr = (result.stderr || '').trim();
      const stdout = (result.stdout || '').trim();
      return {
        ok: false,
        reason: `exit ${result.status}${stderr ? `, stderr: ${stderr}` : ''}${stdout ? `, stdout: ${stdout}` : ''}`,
      };
    }

    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();
    const lines = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const lastNonEmptyLine = lines.length > 0 ? lines[lines.length - 1] : '';

    // Some Git Bash builds may print runtime warnings before the actual cygpath
    // output (for example, missing /dev/shm or /dev/mqueue directories).
    // Accept the check when the final non-empty line is a valid POSIX path.
    if (!/^\/[a-zA-Z]\//.test(lastNonEmptyLine)) {
      const diagnosticStdout = truncateDiagnostic(stdout || '(empty)');
      const diagnosticStderr = stderr ? `, stderr: ${truncateDiagnostic(stderr)}` : '';
      return {
        ok: false,
        reason: `unexpected cygpath output: ${diagnosticStdout}${diagnosticStderr}`,
      };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function getWindowsGitToolDirs(bashPath: string): string[] {
  const normalized = bashPath.replace(/\//g, '\\');
  const lower = normalized.toLowerCase();
  let gitRoot: string | null = null;

  if (lower.endsWith('\\usr\\bin\\bash.exe')) {
    gitRoot = normalized.slice(0, -'\\usr\\bin\\bash.exe'.length);
  } else if (lower.endsWith('\\bin\\bash.exe')) {
    gitRoot = normalized.slice(0, -'\\bin\\bash.exe'.length);
  }

  if (!gitRoot) {
    const bashDir = dirname(normalized);
    return [bashDir].filter(dir => existsSync(dir));
  }

  const candidates = [
    join(gitRoot, 'cmd'),
    join(gitRoot, 'mingw64', 'bin'),
    join(gitRoot, 'usr', 'bin'),
    join(gitRoot, 'bin'),
  ];

  return candidates.filter(dir => existsSync(dir));
}

/**
 * Resolve git-bash path on Windows.
 * Claude Code CLI requires git-bash for shell tool execution.
 * Priority: env var override > bundled PortableGit > installed Git > PATH lookup.
 * Every candidate must pass a health check (`cygpath -u`) before use.
 */
export function resolveGitBashPathForPi(): string | null {
  return resolveWindowsGitBashPath();
}

export function getGitBashResolutionErrorForPi(): string | null {
  return cachedGitBashResolutionError;
}

export function resolveWindowsGitBashPath(): string | null {
  if (cachedGitBashPath !== undefined) return cachedGitBashPath;

  if (process.platform !== 'win32') {
    cachedGitBashPath = null;
    cachedGitBashResolutionError = null;
    return null;
  }

  const candidates: Array<{ path: string; source: string }> = [];
  const seen = new Set<string>();
  const failedCandidates: string[] = [];

  const pushCandidate = (candidatePath: string | null, source: string): void => {
    if (!candidatePath) return;
    const normalized = normalizeWindowsPath(candidatePath);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ path: normalized, source });
  };

  // 1. Explicit env var (user override)
  pushCandidate(process.env.CLAUDE_CODE_GIT_BASH_PATH ?? null, 'env:CLAUDE_CODE_GIT_BASH_PATH');

  // 2. Bundled PortableGit (preferred default in ZhiYuanAgent package)
  for (const bundledCandidate of getBundledGitBashCandidates()) {
    pushCandidate(bundledCandidate, 'bundled:resources/mingit');
  }

  // 3. Common Git for Windows installation paths
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  const userProfile = process.env.USERPROFILE || '';

  const installCandidates = [
    join(programFiles, 'Git', 'bin', 'bash.exe'),
    join(programFiles, 'Git', 'usr', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    join(programFilesX86, 'Git', 'usr', 'bin', 'bash.exe'),
    join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
    join(localAppData, 'Programs', 'Git', 'usr', 'bin', 'bash.exe'),
    join(userProfile, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    join(userProfile, 'scoop', 'apps', 'git', 'current', 'usr', 'bin', 'bash.exe'),
    'C:\\Git\\bin\\bash.exe',
    'C:\\Git\\usr\\bin\\bash.exe',
  ];

  for (const installCandidate of installCandidates) {
    pushCandidate(installCandidate, 'installed:common-paths');
  }

  // 4. Query Git for Windows install root from registry
  const registryInstallRoots = listGitInstallPathsFromRegistry();
  for (const installRoot of registryInstallRoots) {
    const registryCandidates = [
      join(installRoot, 'bin', 'bash.exe'),
      join(installRoot, 'usr', 'bin', 'bash.exe'),
    ];
    for (const registryCandidate of registryCandidates) {
      pushCandidate(registryCandidate, `registry:${installRoot}`);
    }
  }

  // 5. Try `where bash`
  const bashPaths = listWindowsCommandPaths('where bash');
  for (const bashPath of bashPaths) {
    if (bashPath.toLowerCase().endsWith('\\bash.exe')) {
      pushCandidate(bashPath, 'path:where bash');
    }
  }

  // 6. Try `where git` and derive bash from git location
  const gitPaths = listWindowsCommandPaths('where git');
  for (const gitPath of gitPaths) {
    const gitRoot = dirname(dirname(gitPath));
    const bashCandidates = [
      join(gitRoot, 'bin', 'bash.exe'),
      join(gitRoot, 'usr', 'bin', 'bash.exe'),
    ];
    for (const bashCandidate of bashCandidates) {
      pushCandidate(bashCandidate, `path:where git (${gitPath})`);
    }
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) {
      continue;
    }

    const health = checkWindowsGitBashHealth(candidate.path);
    if (health.ok) {
      coworkLog(
        'INFO',
        'resolveGitBash',
        `Selected git-bash (${candidate.source}): ${candidate.path}`,
      );
      cachedGitBashPath = candidate.path;
      cachedGitBashResolutionError = null;
      return candidate.path;
    }

    const failure = `${candidate.path} [${candidate.source}] failed health check (${health.reason || 'unknown reason'})`;
    failedCandidates.push(failure);
    coworkLog('WARN', 'resolveGitBash', failure);
  }

  const diagnostic =
    failedCandidates.length > 0
      ? `No healthy git-bash found. Failures: ${failedCandidates.join('; ')}`
      : 'No git-bash candidates found on this system';
  coworkLog('WARN', 'resolveGitBash', diagnostic);
  cachedGitBashPath = null;
  cachedGitBashResolutionError = truncateDiagnostic(diagnostic);
  return null;
}
