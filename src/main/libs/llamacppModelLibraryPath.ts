import { app } from 'electron';
import path from 'path';
import type { LlamaCppServiceConfig } from '../../shared/llamacpp';

const DEFAULT_WINDOWS_MODEL_LIBRARY_APP_DIR = 'ZhiYuanAgent';

export function resolveLlamaCppModelsDir(config: Pick<LlamaCppServiceConfig, 'modelsDir'>): string {
  const configured = config.modelsDir?.trim();
  if (configured) return configured;
  if (process.platform === 'win32') {
    const localAppDataPath =
      process.env.LOCALAPPDATA?.trim() || path.join(path.dirname(app.getPath('appData')), 'Local');
    return path.join(localAppDataPath, DEFAULT_WINDOWS_MODEL_LIBRARY_APP_DIR, 'models');
  }

  return path.join(app.getPath('userData'), 'models', 'llamacpp');
}
