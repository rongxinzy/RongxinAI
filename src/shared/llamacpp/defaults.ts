import type { NvidiaSmiSnapshot } from '../hardware';
import { LlamaCppMemoryPolicy, LlamaCppOrchestrator } from './constants';
import { LlamaCppKvCacheType } from './kvCacheTypes';
import type { LlamaCppServiceConfig } from './types';

const LLAMACPP_DEFAULT_CONTEXT_HIGH_VRAM_MIB = 20 * 1024;

export const DEFAULT_LLAMACPP_SERVICE_CONFIG: LlamaCppServiceConfig = {
  host: '127.0.0.1',
  port: '8080',
  orchestrator: LlamaCppOrchestrator.Router,
  modelsMax: '3',
  keepRunningOnAppQuit: true,
  timeout: '120',
  threadsHttp: '4',
  cacheReuse: '256',
  cacheRam: '8192',
  parallel: '2',
  kvUnified: true,
  batchSize: '512',
  ubatchSize: '512',
  gpuLayers: 'auto',
  memoryPolicy: LlamaCppMemoryPolicy.Auto,
  memoryBudgetPercent: 50,
};

export interface AutomaticLlamaCppContextOptions {
  platform?: string;
  totalMemoryMiB?: number;
}

export function resolveAutomaticLlamaCppContextSize(
  snapshot: NvidiaSmiSnapshot | null | undefined,
  options?: AutomaticLlamaCppContextOptions,
): string {
  const totalVramMiB = snapshot?.available
    ? snapshot.gpus.reduce((sum, gpu) => sum + gpu.memoryTotalMiB, 0)
    : 0;
  if (totalVramMiB >= LLAMACPP_DEFAULT_CONTEXT_HIGH_VRAM_MIB) return '32768';

  if (options?.totalMemoryMiB !== undefined && options.totalMemoryMiB >= 24 * 1024) {
    return '32768';
  }

  const platform =
    options?.platform ?? (typeof process !== 'undefined' ? process.platform : undefined);
  if (platform === 'darwin') {
    if (options?.totalMemoryMiB !== undefined && options.totalMemoryMiB < 24 * 1024) {
      return '8192';
    }
    return '32768';
  }

  return '8192';
}

export function applyAutomaticLlamaCppServiceDefaults(
  config: LlamaCppServiceConfig,
  input: {
    nvidiaSnapshot?: NvidiaSmiSnapshot | null;
    platform?: string;
    totalMemoryMiB?: number;
  } = {},
): LlamaCppServiceConfig {
  const hasNvidiaGpu = Boolean(
    input.nvidiaSnapshot?.available && input.nvidiaSnapshot.gpus.length > 0,
  );
  return {
    ...config,
    ...(config.ctxSize?.trim()
      ? {}
      : {
          ctxSize: resolveAutomaticLlamaCppContextSize(input.nvidiaSnapshot, {
            platform: input.platform,
            totalMemoryMiB: input.totalMemoryMiB,
          }),
        }),
    ...(hasNvidiaGpu && !config.flashAttn?.trim() ? { flashAttn: 'on' as const } : {}),
    ...(hasNvidiaGpu && !config.cacheTypeK?.trim() ? { cacheTypeK: LlamaCppKvCacheType.Q8_0 } : {}),
    ...(hasNvidiaGpu && !config.cacheTypeV?.trim() ? { cacheTypeV: LlamaCppKvCacheType.Q8_0 } : {}),
  };
}
