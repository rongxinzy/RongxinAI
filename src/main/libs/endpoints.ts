import type { SqliteStore } from '../sqliteStore';

const SkillStoreUrl = {
  ApiDefault: 'https://clawhub.ai/api/v1/skills',
  SiteDefault: 'https://clawhub.ai',
} as const;

/** No-op stub, kept for callers. */
export function refreshEndpointsTestMode(_store: SqliteStore): void {}

/**
 * Server API base URL — configurable via environment variable.
 * Used for auth exchange/refresh, models, proxy, etc.
 * Set LOBSTERAI_SERVER_API_BASE_URL to your own server.
 */
export const getServerApiBaseUrl = (): string => {
  const envUrl = process.env.LOBSTERAI_SERVER_API_BASE_URL?.trim();
  if (envUrl) return envUrl;
  return '';
};

export const getSkillStoreUrl = (): string => {
  const envUrl = process.env.LOBSTERAI_SKILL_STORE_URL?.trim();
  if (envUrl) return envUrl;
  return SkillStoreUrl.ApiDefault;
};

export const getSkillStoreSiteUrl = (): string => {
  const envUrl = process.env.LOBSTERAI_SKILL_STORE_SITE_URL?.trim();
  if (envUrl) return envUrl;
  const apiUrl = getSkillStoreUrl();
  if (apiUrl.endsWith('/api/v1/skills')) {
    return apiUrl.slice(0, -'/api/v1/skills'.length);
  }
  return SkillStoreUrl.SiteDefault;
};

export const getMcpMarketplaceUrl = (): string => '';
export const getLoginOvermindUrl = (): string => '';
