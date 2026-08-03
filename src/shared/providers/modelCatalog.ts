import type { ProviderModelDefinition } from './constants';

export type ProviderModelIndex = ReadonlyMap<
  string,
  ReadonlyMap<string, readonly ProviderModelDefinition[]>
>;

export const normalizeCatalogModelKey = (modelId: string): string => modelId.trim().toLowerCase();

/** Build canonical and alias indexes once so registry lookups stay deterministic and cheap. */
export function buildProviderModelIndex(
  definitions: readonly {
    readonly id: string;
    readonly defaultModels: readonly ProviderModelDefinition[];
    readonly codingPlanModels?: readonly ProviderModelDefinition[];
  }[],
): ProviderModelIndex {
  const providerIndex = new Map<
    string,
    ReadonlyMap<string, readonly ProviderModelDefinition[]>
  >();

  for (const definition of definitions) {
    const models = [...definition.defaultModels, ...(definition.codingPlanModels ?? [])];
    const modelIndex = new Map<string, ProviderModelDefinition[]>();

    // Canonical IDs always win over aliases, even if a future alias collides.
    for (const model of models) {
      const key = normalizeCatalogModelKey(model.id);
      if (!key) continue;
      const matches = modelIndex.get(key) ?? [];
      if (!matches.includes(model)) matches.push(model);
      modelIndex.set(key, matches);
    }
    for (const model of models) {
      for (const alias of model.aliases ?? []) {
        const key = normalizeCatalogModelKey(alias);
        if (!key || modelIndex.has(key)) continue;
        modelIndex.set(key, [model]);
      }
    }

    providerIndex.set(definition.id, modelIndex);
  }

  return providerIndex;
}

export function getIndexedProviderModels(
  index: ProviderModelIndex,
  providerName: string,
  modelId: string | undefined,
): readonly ProviderModelDefinition[] {
  if (typeof modelId !== 'string' || !modelId.trim()) return [];
  return index.get(providerName)?.get(normalizeCatalogModelKey(modelId)) ?? [];
}
