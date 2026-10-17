/**
 * Provider Constants & Registry — Single Source of Truth (re-export barrel).
 *
 * All LLM provider identifiers, default configurations, and metadata are
 * defined across the sibling modules and re-exported here so both main and
 * renderer processes can keep importing from this path.
 *
 * When adding a new provider:
 * 1. Add the provider key to ProviderName (providerIdentities.ts)
 * 2. Add the runtime provider ID to AgentProviderId (providerIdentities.ts)
 * 3. Add one record to the China or Global definitions array
 *    (providerDefinitionsChina.ts / providerDefinitionsGlobal.ts)
 *    — that's it, types and lookups are derived automatically.
 */

export {
  AgentProviderId,
  ApiFormat,
  ModelCapabilityStatus,
  ProviderName,
  ProviderModelOrigin,
} from './providerIdentities';
export type { ModelCapabilities } from './providerIdentities';
export type { ProviderModelDefinition } from './providerDefinitionTypes';
export { ProviderRegistry } from './providerRegistry';
