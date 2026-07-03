import type { LlamaCppChatPayload, LlamaCppServiceConfig } from './types';

export const DEFAULT_LLAMACPP_SERVICE_CONFIG: LlamaCppServiceConfig = {
  host: '127.0.0.1',
  port: '8080',
  modelsMax: '0',
  timeout: '120',
  threadsHttp: '4',
  cacheReuse: '256',
  cacheRam: '8192',
  ctxSize: '4096',
  parallel: '1',
  batchSize: '512',
  ubatchSize: '512',
  gpuLayers: 'auto',
  threads: '-1',
  threadsBatch: '-1',
  mainGpu: '0',
};

export const DEFAULT_LLAMACPP_CHAT_OPTIONS = {
  max_tokens: 1024,
  temperature: 0.7,
  top_k: 40,
  top_p: 0.9,
  repeat_penalty: 1.1,
  min_p: 0.05,
  presence_penalty: 0,
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
