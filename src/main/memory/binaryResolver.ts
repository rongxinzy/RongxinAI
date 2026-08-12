import fs from 'fs';
import path from 'path';

import {
  ENGRAM_PACKAGED_DIRECTORY,
  ENGRAM_RUNTIME_DIRECTORY,
  EngramEnvironment,
} from './constants';

export interface ResolveEngramBinaryOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  resourcesPath?: string;
  projectRoot?: string;
  fileExists?: (candidate: string) => boolean;
}

export function resolveEngramBinary(options: ResolveEngramBinaryOptions = {}): string | null {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const executableName = platform === 'win32' ? 'engram.exe' : 'engram';
  const fileExists = options.fileExists ?? fs.existsSync;
  const explicitPath = env[EngramEnvironment.BinaryPath]?.trim();
  const candidates = [
    explicitPath,
    options.resourcesPath
      ? path.join(options.resourcesPath, ENGRAM_PACKAGED_DIRECTORY, executableName)
      : undefined,
    options.projectRoot
      ? path.join(
          options.projectRoot,
          'vendor',
          ENGRAM_RUNTIME_DIRECTORY,
          'current',
          executableName,
        )
      : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(fileExists) ?? null;
}
