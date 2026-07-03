import type { ApiFormat } from './constants';
import { ProviderName } from './constants';

export interface ProviderConfig {
  enabled: boolean;
  userEnabled?: boolean;
  apiKey: string;
  baseUrl: string;
  apiFormat?: ApiFormat;
  models?: Array<{
    id: string;
    name: string;
    supportsImage?: boolean;
    contextWindow?: number;
    contextTokens?: number;
    maxTokens?: number;
  }>;
  displayName?: string;
  codingPlanEnabled?: boolean;
  authType?: 'apikey' | 'oauth';
  /** OAuth access token (stored separately from apiKey to avoid conflicts) */
  oauthAccessToken?: string;
  /** Base URL returned by OAuth resource_url (stored separately from user-configured baseUrl) */
  oauthBaseUrl?: string;
  oauthRefreshToken?: string;
  oauthTokenExpiresAt?: number;
}

export function isProviderEnabled(
  providerName: string,
  providerConfig?: Pick<ProviderConfig, 'enabled' | 'userEnabled'> | null,
): boolean {
  if (!providerConfig) {
    return false;
  }

  if (providerName === ProviderName.LlamaCpp) {
    return providerConfig.userEnabled === true;
  }

  return providerConfig.enabled === true;
}
