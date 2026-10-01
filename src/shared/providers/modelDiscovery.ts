import type { ApiFormat, ModelCapabilities } from './constants';

export const ProviderModelDiscoveryErrorCode = {
  InvalidConfig: 'invalid_config',
  Authentication: 'authentication',
  EndpointNotFound: 'endpoint_not_found',
  Timeout: 'timeout',
  UnsupportedFormat: 'unsupported_format',
  ResponseTooLarge: 'response_too_large',
  Network: 'network',
  Http: 'http',
} as const;
export type ProviderModelDiscoveryErrorCode =
  (typeof ProviderModelDiscoveryErrorCode)[keyof typeof ProviderModelDiscoveryErrorCode];

export interface ProviderModelDiscoveryRequest {
  baseUrl: string;
  apiKey?: string;
  apiFormat: ApiFormat;
}

export interface DiscoveredProviderModel {
  id: string;
  displayName?: string;
  ownedBy?: string;
  contextWindow?: number;
  maxTokens?: number;
  capabilities?: Partial<ModelCapabilities>;
  /**
   * Marks capability values that came from a runtime probe (llama.cpp /props)
   * rather than from the model list payload. Probes are ground truth, so
   * merge logic may let them overwrite a stale non-Unknown verdict.
   */
  capabilitiesSource?: DiscoveryCapabilitiesSource;
}

export const DiscoveryCapabilitiesSource = {
  RuntimeProbe: 'runtime-probe',
} as const;
export type DiscoveryCapabilitiesSource =
  (typeof DiscoveryCapabilitiesSource)[keyof typeof DiscoveryCapabilitiesSource];

export type ProviderModelDiscoveryResult =
  | { success: true; models: DiscoveredProviderModel[] }
  | { success: false; code: ProviderModelDiscoveryErrorCode; error: string };
