import type { SqliteStore } from '../sqliteStore';

/** No-op stub, kept for callers. */
export function refreshEndpointsTestMode(_store: SqliteStore): void {}

export const getSkillStoreUrl = (): string => '';
export const getMcpMarketplaceUrl = (): string => '';
export const getLoginOvermindUrl = (): string => '';
