import { app } from 'electron';
import { join } from 'node:path';
import { PythonRuntimeService } from './service';

let service: PythonRuntimeService | undefined;

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
  });
  return service;
}

export async function shutdownPythonRuntime(): Promise<void> {
  const current = service;
  service = undefined;
  await current?.shutdown();
}
