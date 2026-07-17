import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const UV_RUNTIME_DIR_NAME = 'uv-win';

function resolveBundledCandidates(): string[] {
  if (app.isPackaged) {
    return [
      path.join(process.resourcesPath, UV_RUNTIME_DIR_NAME),
      path.join(app.getAppPath(), UV_RUNTIME_DIR_NAME),
    ];
  }

  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  return [
    path.join(projectRoot, 'resources', UV_RUNTIME_DIR_NAME),
    path.join(process.cwd(), 'resources', UV_RUNTIME_DIR_NAME),
    path.join(app.getAppPath(), 'resources', UV_RUNTIME_DIR_NAME),
  ];
}

function findExecutable(rootDir: string, name: string): string | null {
  const direct = path.join(rootDir, name);
  if (fs.existsSync(direct)) {
    return direct;
  }

  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
        return fullPath;
      }
    }
  }

  return null;
}

export function getBundledUvRoot(): string | null {
  for (const candidate of resolveBundledCandidates()) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

export function getUserUvRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes', UV_RUNTIME_DIR_NAME);
}

export function findBundledUvExecutable(name: 'uv.exe' | 'uvx.exe'): string | null {
  const candidates = [getUserUvRoot(), getBundledUvRoot()].filter((value): value is string => Boolean(value));
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    const found = findExecutable(root, name);
    if (found) {
      return found;
    }
  }
  return null;
}

export function appendUvRuntimeToEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (process.platform !== 'win32') {
    return env;
  }

  const uvExe = findBundledUvExecutable('uv.exe');
  if (!uvExe) {
    return env;
  }

  const runtimeDir = path.dirname(uvExe);
  const current = env.PATH || '';
  const parts = current ? current.split(';') : [];
  const normalizedDir = runtimeDir.toLowerCase().replace(/[\\/]+$/, '');
  if (!parts.some((entry) => entry.trim().toLowerCase().replace(/[\\/]+$/, '') === normalizedDir)) {
    env.PATH = [runtimeDir, ...parts.filter(Boolean)].join(';');
  }
  env.ZHIYUAN_UV_ROOT = runtimeDir;
  return env;
}
