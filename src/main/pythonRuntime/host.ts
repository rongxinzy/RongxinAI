import { app } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getBundledPythonRoot } from '../libs/pythonRuntime';
import { bundledRuntimeId } from './bundledRuntime';
import { PythonRuntimeService } from './service';

let service: PythonRuntimeService | undefined;

/**
 * Absolute paths into the bundled managed runtime (work package G): the
 * runner consumes these directly and never downloads anything. Resolution is
 * defensive — a missing bundle omits the block and the runner rejects the
 * operation with a reinstall hint instead of breaking session setup.
 */
function resolvePreinstalledRuntime() {
  // Resolution is an optional capability: a partial Electron surface (test
  // doubles) or a stripped build must not break session setup — only an
  // actual python operation reports the missing bundle.
  try {
    // Resolve one installer-owned bundle as a unit. A stale userData runtime
    // must not shadow a newer interpreter, uv or packaged dependency baseline.
    const pythonRoot = getBundledPythonRoot();
    if (!pythonRoot) return undefined;
    const resources = dirname(pythonRoot);
    const isWindows = process.platform === 'win32';
    const platform =
      process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const pythonPath = join(pythonRoot, isWindows ? 'python.exe' : 'bin/python3');
    const uvPath = join(resources, `uv-${platform}`, isWindows ? 'uv.exe' : 'uv');
    const sharedPythonPath = join(
      resources,
      'skill-python',
      'layers',
      'shared',
      isWindows ? 'Scripts/python.exe' : 'bin/python',
    );
    if (![pythonPath, uvPath, sharedPythonPath].every(path => existsSync(path))) return undefined;
    return { pythonPath, uvPath, sharedPythonPath, runtimeId: bundledRuntimeId() };
  } catch (error) {
    console.warn('[PythonRuntime] bundled runtime resolution failed:', error);
    return undefined;
  }
}

/** Creating the host does not download, install or execute anything. */
export function getPythonRuntimeService(): PythonRuntimeService {
  service ??= new PythonRuntimeService({
    storageRoot: join(app.getPath('userData'), 'python-runtime'),
    runnerPath: join(__dirname, 'python-runtime-runner.js'),
    ...(process.platform === 'win32'
      ? {
          jobRunnerPath: app.isPackaged
            ? join(process.resourcesPath, 'python-runtime', 'job-runner.exe')
            : join(app.getAppPath(), 'resources', 'python-runtime', 'job-runner.exe'),
        }
      : {}),
    preinstalledRuntime: resolvePreinstalledRuntime(),
    // One uv cache across both managed stacks (wheels fetched for workspace
    // venvs are reused by Skill-layer builds and vice versa); uv locks safely.
    uvCacheDir: join(app.getPath('userData'), 'runtimes', 'uv-cache'),
  });
  return service;
}

export async function shutdownPythonRuntime(): Promise<void> {
  const current = service;
  service = undefined;
  await current?.shutdown();
}
