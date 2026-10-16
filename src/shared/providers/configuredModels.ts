import { ProviderModelOrigin, ProviderRegistry } from './constants';
import type { ProviderConfig } from './types';
import { normalizeCatalogModelKey } from './modelCatalog';

/** Custom model IDs are opaque; only registry-declared models have aliases. */
export function findConfiguredProviderModel<T extends { id: string }>(
  providerName: string,
  modelId: string,
  models: readonly T[] | undefined,
): T | undefined {
  const requestedId = modelId.trim();
  const exact = models?.find(model => model.id.trim() === requestedId);
  if (exact) return exact;

  // Registry lookups are exact-key: normalize the caller's provider key first,
  // or an AgentProviderId alias / case variant silently kills the alias fallback.
  const registryProviderId = ProviderRegistry.resolveProviderId(providerName) ?? providerName;
  const catalogModel = ProviderRegistry.getModel(registryProviderId, requestedId);
  if (!catalogModel) return undefined;
  return models?.find(
    model => ProviderRegistry.getModel(registryProviderId, model.id)?.id === catalogModel.id,
  );
}

/** Keep the same configured catalog in Settings, the picker, and runtime resolution. */
export function resolveConfiguredProviderModels(
  providerName: string,
  provider: Pick<ProviderConfig, 'models' | 'codingPlanEnabled'>,
): ProviderConfig['models'] {
  const definition = ProviderRegistry.get(providerName);
  const catalog = provider.codingPlanEnabled ? definition?.codingPlanModels : undefined;
  if (!catalog) return provider.models;

  const savedById = new Map(
    provider.models?.map(model => [normalizeCatalogModelKey(model.id), model]),
  );
  const models: NonNullable<ProviderConfig['models']> = catalog.map(model => {
    const saved = savedById.get(normalizeCatalogModelKey(model.id));
    return {
      ...model,
      ...saved,
      id: model.id,
      // Repair old preset labels while keeping names supplied by the endpoint or user.
      name: saved?.origin ? saved.name : model.name,
      capabilities: { ...model.capabilities, ...saved?.capabilities },
    };
  });
  const catalogIds = new Set(catalog.map(model => normalizeCatalogModelKey(model.id)));
  const regularPresetIds = new Set(
    definition?.defaultModels.map(model => normalizeCatalogModelKey(model.id)),
  );
  for (const model of provider.models ?? []) {
    const modelKey = normalizeCatalogModelKey(model.id);
    if (catalogIds.has(modelKey)) continue;
    // Drop untouched general-API presets left over from a plan switch, but retain
    // models discovered, edited, or tested against the configured endpoint.
    if (
      regularPresetIds.has(modelKey) &&
      model.origin !== ProviderModelOrigin.User &&
      model.origin !== ProviderModelOrigin.Discovered &&
      !model.connectionTest
    ) {
      continue;
    }
    models.push(model);
    catalogIds.add(modelKey);
  }
  return models;
}
