import os from 'os';

import type { NvidiaSmiSnapshot } from '../../shared/hardware';
import {
  applyAutomaticLlamaCppServiceDefaults,
  type LlamaCppServiceConfig,
} from '../../shared/llamacpp';

import { getNvidiaSmiSnapshot } from './nvidiaSmi';

export async function getLlamaCppNvidiaSnapshot(): Promise<NvidiaSmiSnapshot | null> {
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    return null;
  }
  try {
    return await getNvidiaSmiSnapshot();
  } catch {
    return null;
  }
}

export function hasAvailableNvidiaGpu(snapshot: NvidiaSmiSnapshot | null | undefined): boolean {
  return Boolean(snapshot?.available && snapshot.gpus.length > 0);
}

export async function resolveLlamaCppHostServiceDefaults(
  config: LlamaCppServiceConfig,
): Promise<LlamaCppServiceConfig> {
  return applyAutomaticLlamaCppServiceDefaults(config, {
    nvidiaSnapshot: await getLlamaCppNvidiaSnapshot(),
    platform: process.platform,
    totalMemoryMiB: Math.floor(os.totalmem() / (1024 * 1024)),
  });
}
