import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { getManagedPythonExecutable } from './pythonRuntime';

const UV_RUNTIME_DIR_NAME =
  process.platform === 'darwin' ? 'uv-mac' : process.platform === 'linux' ? 'uv-linux' : 'uv-win';
const IS_WINDOWS = process.platform === 'win32';
type UvExecutableName = 'uv.exe' | 'uvx.exe' | 'uv' | 'uvx';

function executableName(name: 'uv' | 'uvx'): UvExecutableName {
  return IS_WINDOWS ? `${name}.exe` : name;
}

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

export function findBundledUvExecutable(name: UvExecutableName): string | null {
  const candidates = [getUserUvRoot(), getBundledUvRoot()].filter((value): value is string =>
    Boolean(value),
  );
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    const found = findExecutable(root, name);
    if (found) {
      return found;
    }
  }
  return null;
}

export function appendUvRuntimeToEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
    return env;
  }

  const uvExe = findBundledUvExecutable(executableName('uv'));
  if (!uvExe) {
    return env;
  }

  const runtimeDir = path.dirname(uvExe);
  const current = env.PATH || '';
  const separator = IS_WINDOWS ? ';' : ':';
  const parts = current ? current.split(separator) : [];
  const normalizedDir = runtimeDir.toLowerCase().replace(/[\\/]+$/, '');
  if (
    !parts.some(
      entry =>
        entry
          .trim()
          .toLowerCase()
          .replace(/[\\/]+$/, '') === normalizedDir,
    )
  ) {
    env.PATH = [runtimeDir, ...parts.filter(Boolean)].join(separator);
  }
  env.ZHIYUAN_UV_ROOT = runtimeDir;
  return env;
}

/**
 * Bind uv to the application-private CPython runtime and user-data cache.
 * This prevents a Skill from silently selecting or downloading a system Python
 * while leaving uv responsible for isolated environments and dependencies.
 */
export function configureUvForManagedPython(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) return env;
  const uv = findBundledUvExecutable(executableName('uv'));
  const python = getManagedPythonExecutable();
  if (!uv || !python) return env;
  env.UV_PYTHON = python;
  env.UV_NO_MANAGED_PYTHON = '1';
  env.UV_CACHE_DIR = path.join(app.getPath('userData'), 'runtimes', 'uv-cache');
  env.UV_TOOL_DIR = path.join(app.getPath('userData'), 'runtimes', 'uv-tools');
  env.ZHIYUAN_PYTHON_BIN = python;
  return env;
}
