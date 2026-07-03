import type { NvidiaSmiSnapshot } from '../hardware';
import type { LlamaCppChatPayload, LlamaCppServiceConfig } from './types';

const LLAMACPP_DEFAULT_CONTEXT_HIGH_VRAM_MIB = 20 * 1024;

export const DEFAULT_LLAMACPP_SERVICE_CONFIG: LlamaCppServiceConfig = {
  host: '127.0.0.1',
  port: '8080',
  modelsMax: '0',
  timeout: '120',
  threadsHttp: '4',
  cacheReuse: '256',
  cacheRam: '8192',
  parallel: '1',
  batchSize: '512',
  ubatchSize: '512',
  gpuLayers: 'auto',
};

export const DEFAULT_LLAMACPP_CHAT_OPTIONS = {
  num_predict: -1,
  num_keep: 4,
  temperature: 0.8,
  top_k: 40,
  top_p: 0.9,
  typical_p: 1.0,
  repeat_last_n: 64,
  repeat_penalty: 1.1,
  presence_penalty: 0,
  frequency_penalty: 0,
  seed: -1,
} as const satisfies Record<string, unknown>;

export function mergeLlamaCppChatOptions(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...DEFAULT_LLAMACPP_CHAT_OPTIONS,
    ...(options ?? {}),
  };
}

export function applyLlamaCppChatDefaults(payload: LlamaCppChatPayload): LlamaCppChatPayload {
  return {
    ...payload,
    options: mergeLlamaCppChatOptions(payload.options),
  };
}

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
