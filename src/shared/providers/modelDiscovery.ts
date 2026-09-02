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
}

export type ProviderModelDiscoveryResult =
  | { success: true; models: DiscoveredProviderModel[] }
  | { success: false; code: ProviderModelDiscoveryErrorCode; error: string };
