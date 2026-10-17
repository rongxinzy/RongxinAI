/**
 * Provider definitions — the single source of truth.
 *
 * Registry order: China region first (ZhiYuan, China providers, local
 * runtimes), then Global, matching the Chinese UI display order used by
 * config.ts. Split by region in providerDefinitionsChina.ts and
 * providerDefinitionsGlobal.ts.
 */

import type { ProviderDef } from './providerDefinitionTypes';
import { CHINA_PROVIDER_DEFINITIONS } from './providerDefinitionsChina';
import { GLOBAL_PROVIDER_DEFINITIONS } from './providerDefinitionsGlobal';

export const PROVIDER_DEFINITIONS: readonly ProviderDef[] = [
  ...CHINA_PROVIDER_DEFINITIONS,
  ...GLOBAL_PROVIDER_DEFINITIONS,
];
