import type { SpawnOptions } from 'child_process';

import type { LlamaCppServiceConfig } from '../../shared/llamacpp';

export function shouldKeepLlamaCppServiceRunning(config: LlamaCppServiceConfig): boolean {
  return config.keepRunningOnAppQuit !== false;
}

export function createLlamaCppServerSpawnOptions(input: {
  config: LlamaCppServiceConfig;
  env: NodeJS.ProcessEnv;
}): SpawnOptions {
  const keepRunningOnAppQuit = shouldKeepLlamaCppServiceRunning(input.config);

  return {
    detached: keepRunningOnAppQuit,
    // Piped stdio would keep Electron alive after the detached service is released.
    stdio: keepRunningOnAppQuit ? 'ignore' : ['ignore', 'pipe', 'pipe'],
    env: input.env,
    windowsHide: true,
  };
}
