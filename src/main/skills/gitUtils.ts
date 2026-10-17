import { spawnSync } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { normalizeFolderName } from './skillMarkdown';

export type NormalizedGitSource = {
  repoUrl: string;
  sourceSubpath?: string;
  ref?: string;
  repoNameHint?: string;
};

export type GithubRepoSource = {
  owner: string;
  repo: string;
};

const appendEnvPath = (current: string | undefined, entries: string[]): string => {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const existing = (current || '').split(delimiter).filter(Boolean);
  const merged = [...existing];
  entries.forEach(entry => {
    if (!entry || merged.includes(entry)) return;
    merged.push(entry);
  });
  return merged.join(delimiter);
};

const listWindowsCommandPaths = (command: string): string[] => {
  if (process.platform !== 'win32') return [];

  try {
    const result = spawnSync('cmd.exe', ['/d', '/s', '/c', command], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) return [];
    return result.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const resolveWindowsGitExecutable = (): string | null => {
  if (process.platform !== 'win32') return null;

  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  const userProfile = process.env.USERPROFILE || '';

  const installedCandidates = [
    path.join(programFiles, 'Git', 'cmd', 'git.exe'),
    path.join(programFiles, 'Git', 'bin', 'git.exe'),
    path.join(programFilesX86, 'Git', 'cmd', 'git.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'git.exe'),
    path.join(localAppData, 'Programs', 'Git', 'cmd', 'git.exe'),
    path.join(localAppData, 'Programs', 'Git', 'bin', 'git.exe'),
    path.join(userProfile, 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'),
    path.join(userProfile, 'scoop', 'apps', 'git', 'current', 'bin', 'git.exe'),
    'C:\\Git\\cmd\\git.exe',
    'C:\\Git\\bin\\git.exe',
  ];

  for (const candidate of installedCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const whereCandidates = listWindowsCommandPaths('where git');
  for (const candidate of whereCandidates) {
    const normalized = candidate.trim();
    if (!normalized) continue;
    if (normalized.toLowerCase().endsWith('git.exe') && fs.existsSync(normalized)) {
      return normalized;
    }
  }

  const bundledRoots = app.isPackaged
    ? [path.join(process.resourcesPath, 'mingit')]
    : [
        path.join(__dirname, '..', '..', 'resources', 'mingit'),
        path.join(process.cwd(), 'resources', 'mingit'),
      ];

  for (const root of bundledRoots) {
    const bundledCandidates = [
      path.join(root, 'cmd', 'git.exe'),
      path.join(root, 'bin', 'git.exe'),
      path.join(root, 'mingw64', 'bin', 'git.exe'),
      path.join(root, 'usr', 'bin', 'git.exe'),
    ];
    for (const candidate of bundledCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

export const resolveGitCommand = (): { command: string; env?: NodeJS.ProcessEnv } => {
  if (process.platform !== 'win32') {
    return { command: 'git' };
  }

  const gitExe = resolveWindowsGitExecutable();
  if (!gitExe) {
    return { command: 'git' };
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  const gitDir = path.dirname(gitExe);
  const gitRoot = path.dirname(gitDir);
  const candidateDirs = [
    gitDir,
    path.join(gitRoot, 'cmd'),
    path.join(gitRoot, 'bin'),
    path.join(gitRoot, 'mingw64', 'bin'),
    path.join(gitRoot, 'usr', 'bin'),
  ].filter(dir => fs.existsSync(dir));

  env.PATH = appendEnvPath(env.PATH, candidateDirs);
  return { command: gitExe, env };
};

export const deriveRepoName = (source: string): string => {
  const cleaned = source.replace(/[#?].*$/, '');
  const base = cleaned.split('/').filter(Boolean).pop() || 'skill';
  return normalizeFolderName(base.replace(/\.git$/, ''));
};

export const parseGithubRepoSource = (repoUrl: string): GithubRepoSource | null => {
  const trimmed = repoUrl.trim();

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    };
  }

  try {
    const parsedUrl = new URL(trimmed);
    if (!['github.com', 'www.github.com'].includes(parsedUrl.hostname.toLowerCase())) {
      return null;
    }

    const segments = parsedUrl.pathname
      .replace(/\.git$/i, '')
      .split('/')
      .filter(Boolean);
    if (segments.length < 2) {
      return null;
    }

    return {
      owner: segments[0],
      repo: segments[1],
    };
  } catch {
    return null;
  }
};

const normalizeGithubSubpath = (value: string): string | null => {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return null;
  const segments = trimmed
    .split('/')
    .filter(Boolean)
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  if (segments.some(segment => segment === '.' || segment === '..')) {
    return null;
  }
  return segments.join('/');
};

const parseGithubTreeOrBlobUrl = (source: string): NormalizedGitSource | null => {
  try {
    const parsedUrl = new URL(source);
    if (!['github.com', 'www.github.com'].includes(parsedUrl.hostname)) {
      return null;
    }

    const segments = parsedUrl.pathname.split('/').filter(Boolean);
    if (segments.length < 5) {
      return null;
    }

    const [owner, repoRaw, mode, ref, ...rest] = segments;
    if (!owner || !repoRaw || !ref || (mode !== 'tree' && mode !== 'blob')) {
      return null;
    }

    const repo = repoRaw.replace(/\.git$/i, '');
    const sourceSubpath = normalizeGithubSubpath(rest.join('/'));
    if (!repo || !sourceSubpath) {
      return null;
    }

    return {
      repoUrl: `https://github.com/${owner}/${repo}.git`,
      sourceSubpath,
      ref: decodeURIComponent(ref),
      repoNameHint: repo,
    };
  } catch {
    return null;
  }
};

export const normalizeGitSource = (source: string): NormalizedGitSource | null => {
  const githubTreeOrBlob = parseGithubTreeOrBlobUrl(source);
  if (githubTreeOrBlob) {
    return githubTreeOrBlob;
  }

  if (/^[\w.-]+\/[\w.-]+$/.test(source)) {
    return {
      repoUrl: `https://github.com/${source}.git`,
    };
  }
  if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('git@')) {
    return {
      repoUrl: source,
    };
  }
  if (source.endsWith('.git')) {
    return {
      repoUrl: source,
    };
  }
  return null;
};
