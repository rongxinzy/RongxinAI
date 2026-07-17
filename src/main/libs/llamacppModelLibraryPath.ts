import path from 'path';

const DEFAULT_WINDOWS_MODEL_LIBRARY_APP_DIR = 'ZhiYuanAgent';

export function getDefaultLlamaCppModelsDir(input: {
  platform: NodeJS.Platform;
  localAppDataPath?: string;
  appDataPath: string;
  userDataPath: string;
}): string {
  if (input.platform === 'win32') {
    const localAppDataPath =
      input.localAppDataPath?.trim() || path.join(path.dirname(input.appDataPath), 'Local');
    return path.join(localAppDataPath, DEFAULT_WINDOWS_MODEL_LIBRARY_APP_DIR, 'models');
  }

  return path.join(input.userDataPath, 'models', 'llamacpp');
}
