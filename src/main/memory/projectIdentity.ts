import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface ProjectIdentity {
  id: string;
  displayName: string;
  root: string;
  canonicalSource: string;
}

export interface ResolveProjectIdentityOptions {
  runGit?: (cwd: string, args: string[]) => string | null;
  realpath?: (candidate: string) => string;
  platform?: NodeJS.Platform;
}

export function resolveProjectIdentity(
  workingDirectory: string,
  options: ResolveProjectIdentityOptions = {},
): ProjectIdentity {
  const runGit = options.runGit ?? runGitCommand;
  const realpath = options.realpath ?? resolveRealPath;
  const platform = options.platform ?? process.platform;
  const gitRoot = runGit(workingDirectory, ['rev-parse', '--show-toplevel']);
  const root = realpath(gitRoot || workingDirectory);
  const remote = gitRoot ? runGit(root, ['config', '--get', 'remote.origin.url']) : null;
  const canonicalRemote = remote ? normalizeGitRemote(remote) : null;
  const normalizedRoot = normalizePath(root, platform);
  const canonicalSource = canonicalRemote ? `git:${canonicalRemote}` : `path:${normalizedRoot}`;
  const digest = createHash('sha256').update(canonicalSource).digest('hex').slice(0, 24);

  return {
    id: `project-${digest}`,
    displayName: path.basename(root),
    root,
    canonicalSource,
  };
}

export function normalizeGitRemote(remote: string): string | null {
  const trimmed = remote.trim().replace(/\\/g, '/');
  if (!trimmed) return null;
  const scpMatch = trimmed.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (scpMatch && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return `${scpMatch[1].toLowerCase()}/${stripGitSuffix(scpMatch[2])}`;
  }
  try {
    const url = new URL(trimmed);
    return `${url.hostname.toLowerCase()}/${stripGitSuffix(url.pathname)}`;
  } catch {
    return stripGitSuffix(trimmed).toLowerCase();
  }
}

function stripGitSuffix(value: string): string {
  return value
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

function normalizePath(candidate: string, platform: NodeJS.Platform): string {
  const normalized = path.normalize(candidate).replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function resolveRealPath(candidate: string): string {
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function runGitCommand(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 2_000,
    }).trim();
  } catch {
    return null;
  }
}
