/**
 * Provider registry implementation.
 *
 * Indexes the provider definitions and resolves provider/model lookups,
 * coding-plan endpoints, and model capabilities. Exposed as the singleton
 * `ProviderRegistry`.
 */

import {
  buildProviderModelIndex,
  getIndexedProviderModels,
  type ProviderModelIndex,
} from './modelCatalog';
import type { ProviderDef, ProviderModelDefinition } from './providerDefinitionTypes';
import { PROVIDER_DEFINITIONS } from './providerDefinitions';
import {
  CATALOG_MODEL_CAPABILITIES,
  CATALOG_PROVIDER_TOOL_CAPABILITIES,
  CATALOG_TOOL_CALLING_MODEL_IDS,
} from './providerCatalogCapabilities';
import {
  AgentProviderId,
  ApiFormat,
  ModelCapabilityStatus,
  type ModelCapabilities,
  ProviderName,
  UNKNOWN_MODEL_CAPABILITIES,
} from './providerIdentities';

class ProviderRegistryImpl {
  private readonly defs: readonly ProviderDef[];
  private readonly idIndex: ReadonlyMap<string, ProviderDef>;
  private readonly modelIndex: ProviderModelIndex;

  constructor(definitions: readonly ProviderDef[]) {
    this.defs = definitions;
    const idx = new Map<string, ProviderDef>();
    for (const def of definitions) {
      idx.set(def.id, def);
    }
    this.idIndex = idx;
    this.modelIndex = buildProviderModelIndex(definitions);
  }

  /** All provider IDs in definition order. */
  get providerIds(): readonly string[] {
    return this.defs.map(d => d.id);
  }

  /** Get full definition for a provider. Returns undefined for unknown IDs. */
  get(id: string): ProviderDef | undefined {
    return this.idIndex.get(id);
  }

  /** Whether a provider supports codingPlan. */
  supportsCodingPlan(id: string): boolean {
    return this.idIndex.get(id)?.codingPlanSupported ?? false;
  }

  /** Providers filtered by region, preserving definition order. */
  byRegion(region: 'china' | 'global'): readonly ProviderDef[] {
    return this.defs.filter(d => d.region === region);
  }

  getCodingPlanUrl(id: string, format: 'openai' | 'anthropic'): string | undefined {
    const def = this.idIndex.get(id);
    if (!def?.codingPlanSupported || !def.codingPlanUrls) return undefined;
    return def.codingPlanUrls[format];
  }

  getSwitchableBaseUrl(id: string, format: 'openai' | 'anthropic'): string | undefined {
    return this.idIndex.get(id)?.switchableBaseUrls?.[format];
  }

  getAgentProviderId(providerName: string): string {
    return (
      this.idIndex.get(providerName)?.agentProviderId ?? providerName ?? AgentProviderId.Zhiyuan
    );
  }

  /** Resolve a runtime provider ID back to its application configuration key. */
  getProviderNameByAgentProviderId(agentProviderId: string): string | undefined {
    return this.defs.find(def => def.agentProviderId === agentProviderId)?.id;
  }

  /**
   * Map a caller-supplied provider key (canonical id, AgentProviderId alias, or
   * a case variant of either) to the canonical provider id. Registry model
   * lookups are exact-key, so callers must normalize before resolving aliases.
   */
  resolveProviderId(name: string): string | undefined {
    const trimmed = name.trim();
    if (!trimmed) return undefined;
    const direct = this.idIndex.get(trimmed);
    if (direct) return direct.id;
    const byAgentProviderId = this.getProviderNameByAgentProviderId(trimmed);
    if (byAgentProviderId) return byAgentProviderId;
    const lowered = trimmed.toLowerCase();
    return this.defs.find(
      def => def.id.toLowerCase() === lowered || def.agentProviderId.toLowerCase() === lowered,
    )?.id;
  }

  getProviderModelSupportsImage(providerName: string, modelId: string): boolean | undefined {
    const model = this.getModel(providerName, modelId);
    return model?.supportsImage;
  }

  /**
   * Return all provider-owned entries matching a canonical ID or alias.
   * Matching is case-insensitive, but the returned model keeps its canonical ID.
   */
  getModels(providerName: string, modelId: string | undefined): readonly ProviderModelDefinition[] {
    return getIndexedProviderModels(this.modelIndex, providerName, modelId);
  }

  /** Find the first provider-owned catalog entry; IDs are never matched globally. */
  getModel(providerName: string, modelId: string | undefined): ProviderModelDefinition | undefined {
    return this.getModels(providerName, modelId)[0];
  }

  /** Find every catalog owner of a model ID; callers must keep the provider pair. */
  findModelsById(
    modelId: string | undefined,
  ): Array<{ providerId: string; model: ProviderModelDefinition }> {
    if (typeof modelId !== 'string' || !modelId.trim()) return [];
    const matches: Array<{ providerId: string; model: ProviderModelDefinition }> = [];
    for (const def of this.defs) {
      const model = this.getModel(def.id, modelId);
      if (model) matches.push({ providerId: def.id, model });
    }
    return matches;
  }

  resolveModelCapabilities(
    providerName: string,
    modelId: string,
    apiFormat: ApiFormat,
    configured?: {
      readonly supportsImage?: boolean;
      readonly capabilities?: Partial<ModelCapabilities>;
    },
  ): ModelCapabilities {
    const providerModels = this.getModels(providerName, modelId);
    const providerModel =
      providerModels.find(
        candidate =>
          configured?.supportsImage !== undefined &&
          candidate.supportsImage === configured.supportsImage,
      ) ?? providerModels[0];
    const isCatalogModel = providerModel !== undefined;
    const catalogModelId = providerModel?.id ?? modelId;
    const catalogCapabilities = CATALOG_MODEL_CAPABILITIES[providerName]?.[catalogModelId];
    const hasVerifiedCatalogToolCalling =
      CATALOG_TOOL_CALLING_MODEL_IDS[providerName]?.includes(catalogModelId) === true;
    const endpointToolCalling = CATALOG_PROVIDER_TOOL_CAPABILITIES[providerName]?.[apiFormat];
    const configuredCapabilities = isCatalogModel ? undefined : configured?.capabilities;
    const imageSupport = this.resolveModelSupportsImage(
      providerName,
      modelId,
      configured?.supportsImage,
    );
    // Same residue rule as toolCalling: an explicit configured
    // supported/unsupported is user intent and wins; "unknown" is the
    // default residue of the capability form and must fall through.
    // Falling through lands on the toggle only when it is positively
    // checked — Settings always writes a supportsImage boolean, so a
    // derived false must not turn an unstated "unknown" into
    // "unsupported" (it would lose the three-state capability selector's
    // unknown state on reload).
    const declaredImageCapability =
      (providerModel?.capabilities?.imageInput === ModelCapabilityStatus.Supported ||
      providerModel?.capabilities?.imageInput === ModelCapabilityStatus.Unsupported
        ? providerModel?.capabilities?.imageInput
        : undefined) ??
      (configuredCapabilities?.imageInput === ModelCapabilityStatus.Supported ||
      configuredCapabilities?.imageInput === ModelCapabilityStatus.Unsupported
        ? configuredCapabilities?.imageInput
        : undefined);
    const imageCapability =
      declaredImageCapability ??
      (isCatalogModel
        ? // Catalog declarations are authoritative even against a stale
          // configured toggle (resolveModelSupportsImage repairs known
          // provider metadata); only user-added models fall back to the
          // positively checked toggle.
          imageSupport
          ? ModelCapabilityStatus.Supported
          : ModelCapabilityStatus.Unsupported
        : configured?.supportsImage === true
          ? ModelCapabilityStatus.Supported
          : ModelCapabilityStatus.Unknown);
    return {
      ...UNKNOWN_MODEL_CAPABILITIES,
      ...catalogCapabilities,
      ...providerModel?.capabilities,
      ...configuredCapabilities,
      imageInput: imageCapability,
      toolCalling:
        catalogCapabilities?.toolCalling ??
        providerModel?.capabilities?.toolCalling ??
        (endpointToolCalling === ModelCapabilityStatus.Unsupported
          ? ModelCapabilityStatus.Unsupported
          : undefined) ??
        // An explicit configured supported/unsupported is user intent and
        // wins. An explicit "unknown" is not a verdict — it is the default
        // residue of the capability form (DEFAULT_CUSTOM_MODEL_CAPABILITIES),
        // so it must not short-circuit the endpoint declaration below.
        (configuredCapabilities?.toolCalling === ModelCapabilityStatus.Supported ||
        configuredCapabilities?.toolCalling === ModelCapabilityStatus.Unsupported
          ? configuredCapabilities.toolCalling
          : undefined) ??
        // Catalog models keep their evidence requirement — an endpoint
        // accepting `tools` does not prove every model can emit tool calls.
        // The absence of a verdict, however, defaults optimistically to
        // Supported. Explicit model metadata and runtime detection above
        // retain precedence for known unsupported models.
        (isCatalogModel
          ? hasVerifiedCatalogToolCalling
            ? endpointToolCalling
            : undefined
          : endpointToolCalling) ??
        ModelCapabilityStatus.Supported,
    };
  }

  resolveModelSupportsImage(
    providerName: string,
    modelId: string,
    configuredSupportsImage?: boolean,
  ): boolean {
    const providerModels = this.getModels(providerName, modelId);
    if (
      providerModels.length > 1 &&
      new Set(providerModels.map(candidate => candidate.supportsImage)).size > 1 &&
      configuredSupportsImage !== undefined
    ) {
      return configuredSupportsImage;
    }
    if (providerModels.length > 0) {
      return providerModels[0].supportsImage;
    }

    // A bare model ID is not a capability proof across providers. Preserve the
    // provider-specific explicit value and otherwise stay conservatively false.
    return configuredSupportsImage ?? false;
  }

  /** Provider IDs filtered by region. */
  idsByRegion(region: 'china' | 'global'): readonly string[] {
    return this.defs.filter(d => d.region === region).map(d => d.id);
  }

  /**
   * Provider IDs for English locale display:
   * EN_PRIORITY providers first (sorted by enPriority), then CHINA, then remaining GLOBAL.
   * local providers are always pushed to the end, with Ollama last.
   */
  idsForEnLocale(): readonly string[] {
    const priority = this.defs
      .filter(d => d.enPriority > 0)
      .sort((a, b) => a.enPriority - b.enPriority)
      .map(d => d.id);
    const china = this.idsByRegion('china');
    const global = this.idsByRegion('global');

    const orderedProviders = [...priority, ...china, ...global];
    const unique = [...new Set(orderedProviders)];

    // Move local providers to the end.
    for (const localProvider of [ProviderName.LlamaCpp, ProviderName.Ollama]) {
      const idx = unique.indexOf(localProvider);
      if (idx !== -1) {
        unique.splice(idx, 1);
      }
    }
    unique.push(ProviderName.LlamaCpp);
    unique.push(ProviderName.Ollama);
    return unique;
  }
}

export const ProviderRegistry = new ProviderRegistryImpl(PROVIDER_DEFINITIONS);
