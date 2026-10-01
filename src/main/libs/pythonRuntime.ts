import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { cpRecursiveSync } from '../fsCompat';

const PYTHON_RUNTIME_DIR_NAME =
  process.platform === 'darwin'
    ? 'python-mac'
    : process.platform === 'linux'
      ? 'python-linux'
      : 'python-win';
const IS_WINDOWS = process.platform === 'win32';

const REQUIRED_FILES = IS_WINDOWS ? ['python.exe', 'python3.exe'] : [path.join('bin', 'python3')];

function findPythonExecutable(rootDir: string): string | null {
  const candidates = IS_WINDOWS
    ? [path.join(rootDir, 'python.exe'), path.join(rootDir, 'python3.exe')]
    : [path.join(rootDir, 'bin', 'python3'), path.join(rootDir, 'bin', 'python')];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Resolve the app-private interpreter that Skills and uv must use on Windows. */
export function getManagedPythonExecutable(): string | null {
  // Windows prefers the bundled junction: it is the installer-activated,
  // content-addressed runtime; the user copy only exists as a legacy fallback.
  const roots = IS_WINDOWS
    ? [getBundledPythonRoot(), getUserPythonRoot()]
    : [getUserPythonRoot(), getBundledPythonRoot()];
  for (const root of roots) {
    if (!root) continue;
    const executable = findPythonExecutable(root);
    if (executable) return executable;
  }
  return null;
}

function readEmbedPthFiles(rootDir: string): string[] {
  try {
    return fs.readdirSync(rootDir).filter(name => name.endsWith('._pth'));
  } catch {
    return [];
  }
}

function appendWindowsPath(current: string | undefined, entries: string[]): string | undefined {
  const delimiter = ';';
  const seen = new Set<string>();
  const merged: string[] = [];

  const append = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const normalized = trimmed.toLowerCase().replace(/[\\/]+$/, '');
    if (seen.has(normalized)) return;
    seen.add(normalized);
    merged.push(trimmed);
  };

  entries.forEach(append);
  (current || '').split(delimiter).forEach(append);

  return merged.length > 0 ? merged.join(delimiter) : current;
}

function runtimeHealth(
  rootDir: string,
  options: { requireEmbedSiteConfig?: boolean } = {},
): { ok: boolean; missing: string[] } {
  const requireEmbedSiteConfig = options.requireEmbedSiteConfig !== false;
  const missing: string[] = [];

  for (const relPath of REQUIRED_FILES) {
    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) {
      missing.push(relPath);
    }
  }

  if (requireEmbedSiteConfig) {
    const pthFiles = readEmbedPthFiles(rootDir);
    if (pthFiles.length > 0) {
      const pthPath = path.join(rootDir, pthFiles[0]);
      try {
        const raw = fs.readFileSync(pthPath, 'utf8');
        const lines = raw.split(/\r?\n/).map(line => line.trim().toLowerCase());
        const hasImportSite = lines.includes('import site');
        const hasSitePackages =
          lines.includes('lib\\site-packages') || lines.includes('lib/site-packages');
        if (!hasImportSite || !hasSitePackages) {
          missing.push(`${pthFiles[0]} config (require "Lib\\site-packages" and "import site")`);
        }
      } catch {
        missing.push(`${pthFiles[0]} read failed`);
      }
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

function resolveBundledCandidates(): string[] {
  if (app.isPackaged) {
    return [
      path.join(process.resourcesPath, PYTHON_RUNTIME_DIR_NAME),
      path.join(app.getAppPath(), PYTHON_RUNTIME_DIR_NAME),
    ];
  }

  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  return [
    path.join(projectRoot, 'resources', PYTHON_RUNTIME_DIR_NAME),
    path.join(process.cwd(), 'resources', PYTHON_RUNTIME_DIR_NAME),
    path.join(app.getAppPath(), 'resources', PYTHON_RUNTIME_DIR_NAME),
  ];
}

export function getBundledPythonRoot(): string | null {
  const candidates = resolveBundledCandidates();
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

export function getUserPythonRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes', PYTHON_RUNTIME_DIR_NAME);
}

export function appendPythonRuntimeToEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
    return env;
  }

  const userRoot = getUserPythonRoot();
  const bundledRoot = getBundledPythonRoot();
  // Windows executes the bundled junction in place; the user copy is only a
  // legacy fallback, so it must never shadow the installer-managed runtime.
  const candidates = (IS_WINDOWS ? [bundledRoot, userRoot] : [userRoot, bundledRoot]).filter(
    (value): value is string => Boolean(value),
  );
  const pathEntries: string[] = [];
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    pathEntries.push(root, path.join(root, 'Scripts'));
  }

  if (pathEntries.length > 0) {
    if (IS_WINDOWS) {
      env.PATH = appendWindowsPath(env.PATH, pathEntries);
    } else {
      const posixEntries = candidates.flatMap(root => [path.join(root, 'bin')]);
      env.PATH = [...posixEntries, ...(env.PATH || '').split(':').filter(Boolean)].join(':');
    }
    env.ZHIYUAN_PYTHON_ROOT = pathEntries[0];
  }

  return env;
}

export async function ensurePythonRuntimeReady(): Promise<{ success: boolean; error?: string }> {
  if (!['win32', 'darwin', 'linux'].includes(process.platform)) {
    return { success: true };
  }

  try {
    if (IS_WINDOWS) {
      // The installer activates the content-addressed python runtime through a
      // junction under resources. Execute it in place: copying it into roaming
      // userData doubled disk usage and made first launches stall for minutes,
      // and nothing may write into the shared component tree (its content id
      // is measured by the installer). The build normalizes the embedded _pth,
      // so the runtime is used strictly read-only here.
      const bundledRoot = getBundledPythonRoot();
      if (bundledRoot) {
        const bundledHealth = runtimeHealth(bundledRoot, { requireEmbedSiteConfig: true });
        if (!bundledHealth.ok) {
          const message = `Bundled python runtime is unhealthy (missing: ${bundledHealth.missing.join(', ')})`;
          console.error(`[python-runtime] ${message}`);
          return { success: false, error: message };
        }

        const userRoot = getUserPythonRoot();
        if (fs.existsSync(userRoot)) {
          console.log(`[python-runtime] Removing legacy user runtime copy: ${userRoot}`);
          fs.rmSync(userRoot, { recursive: true, force: true });
        }
        console.log('[python-runtime] Bundled runtime ready');
        return { success: true };
      }

      // Degraded fallback for a broken installation: a legacy user copy keeps
      // python usable until the app is repaired or reinstalled.
      const legacyHealth = runtimeHealth(getUserPythonRoot(), { requireEmbedSiteConfig: true });
      if (legacyHealth.ok) {
        console.warn('[python-runtime] Bundled runtime missing; using the legacy user copy');
        return { success: true };
      }
      const message = 'Bundled python runtime not found in application resources.';
      console.error(`[python-runtime] ${message}`);
      return { success: false, error: message };
    }

    // macOS and Linux keep syncing into userData: the bundled runtime lives
    // inside app bundle or read-only install locations.
    const userRoot = getUserPythonRoot();
    const userHealth = runtimeHealth(userRoot, { requireEmbedSiteConfig: false });
    if (userHealth.ok) {
      console.log('[python-runtime] User runtime already healthy');
      return { success: true };
    }

    const bundledRoot = getBundledPythonRoot();
    if (!bundledRoot) {
      const message = 'Bundled python runtime not found in application resources.';
      console.error(`[python-runtime] ${message}`);
      return { success: false, error: message };
    }

    const bundledHealth = runtimeHealth(bundledRoot, { requireEmbedSiteConfig: false });
    if (!bundledHealth.ok) {
      const message = `Bundled python runtime is unhealthy (missing: ${bundledHealth.missing.join(', ')})`;
      console.error(`[python-runtime] ${message}`);
      return { success: false, error: message };
    }

    console.log(`[python-runtime] Sync runtime to userData: ${userRoot}`);
    if (fs.existsSync(userRoot)) {
      fs.rmSync(userRoot, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(userRoot), { recursive: true });
    cpRecursiveSync(bundledRoot, userRoot, { force: true, dereference: true });

    const syncedHealth = runtimeHealth(userRoot, { requireEmbedSiteConfig: false });
    if (!syncedHealth.ok) {
      const message = `Synced python runtime is unhealthy (missing: ${syncedHealth.missing.join(', ')})`;
      console.error(`[python-runtime] ${message}`);
      return { success: false, error: message };
    }

    console.log('[python-runtime] Runtime sync complete');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[python-runtime] Failed to ensure runtime ready:', message);
    return { success: false, error: message };
  }
}
