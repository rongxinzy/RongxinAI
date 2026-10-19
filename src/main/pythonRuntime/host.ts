import { app } from 'electron';
import { join } from 'node:path';
import { getManagedPythonExecutable } from '../libs/pythonRuntime';
import { findBundledUvExecutable } from '../libs/uvRuntime';
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
    const pythonPath = getManagedPythonExecutable();
    const uvPath = findBundledUvExecutable(process.platform === 'win32' ? 'uv.exe' : 'uv');
    if (!pythonPath || !uvPath) return undefined;
    return { pythonPath, uvPath, runtimeId: bundledRuntimeId() };
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
  });
  return service;
}

export async function shutdownPythonRuntime(): Promise<void> {
  const current = service;
  service = undefined;
  await current?.shutdown();
}
