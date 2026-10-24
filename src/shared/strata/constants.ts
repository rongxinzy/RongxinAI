export const StrataIpcChannel = {
  StatusChanged: 'strata:status-changed',
  IsBundled: 'strata:is-bundled',
  Catalog: 'strata:catalog',
  Status: 'strata:status',
  Start: 'strata:start',
  Stop: 'strata:stop',
  ServiceConfigGet: 'strata:service-config:get',
  ServiceConfigSet: 'strata:service-config:set',
} as const;

/** Loopback port for Strata OpenAI-compatible API (llama.cpp gateway defaults to 8080). */
export const STRATA_DEFAULT_SERVE_PORT = 8096;

export const STRATA_MAGPIE_PROVIDER_ID = 'zhiyuan-host-strata';

export const StrataEngineKind = {
  Qwen: 'qwen',
  DeepSeek41: 'deepseek41',
} as const;

export type StrataEngineKind = (typeof StrataEngineKind)[keyof typeof StrataEngineKind];

export const StrataFamilyId = {
  QwenFlashNext: 'qwen',
  Qwen36: 'qwen36',
  DeepSeek41: 'deepseek41',
} as const;

export type StrataFamilyId = (typeof StrataFamilyId)[keyof typeof StrataFamilyId];
