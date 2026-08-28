import path from 'path';

export const resolveAcpAdapterRoot = (input: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string =>
  input.isPackaged ? path.join(input.resourcesPath, 'app.asar.unpacked') : input.appPath;
