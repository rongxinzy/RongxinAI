import type { NvidiaSmiSnapshot } from '../hardware';
import { LlamaCppMemoryPolicy } from './constants';
import type { LlamaCppServiceConfig } from './types';

const LLAMACPP_DEFAULT_CONTEXT_HIGH_VRAM_MIB = 20 * 1024;

export const DEFAULT_LLAMACPP_SERVICE_CONFIG: LlamaCppServiceConfig = {
  host: '127.0.0.1',
  port: '8080',
  modelsMax: '3',
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

export function resolveAutomaticLlamaCppContextSize(
  snapshot: NvidiaSmiSnapshot | null | undefined,
): string {
  const totalVramMiB = snapshot?.available
    ? snapshot.gpus.reduce((sum, gpu) => sum + gpu.memoryTotalMiB, 0)
    : 0;
  if (totalVramMiB >= LLAMACPP_DEFAULT_CONTEXT_HIGH_VRAM_MIB) return '32768';
  return '8192';
}

export function applyAutomaticLlamaCppServiceDefaults(
  config: LlamaCppServiceConfig,
  input: { nvidiaSnapshot?: NvidiaSmiSnapshot | null } = {},
): LlamaCppServiceConfig {
  return {
    ...config,
    ...(config.ctxSize?.trim()
      ? {}
      : { ctxSize: resolveAutomaticLlamaCppContextSize(input.nvidiaSnapshot) }),
  };
}
