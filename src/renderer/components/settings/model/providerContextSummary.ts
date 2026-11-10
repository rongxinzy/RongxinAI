import type { MagpieModel, MagpieProviderSummary } from '../../../../shared/magpie/types';

export type ProviderContextSource = 'manual' | 'auto' | 'system' | 'unset';

export interface ProviderContextEntry {
  modelId: string;
  tokens?: number;
  source: ProviderContextSource;
}

/**
 * What each of a provider's models will actually be told its window is:
 * the user's declaration first (own id, then "*"), otherwise the window the
 * gateway resolved from the vendor list / models.dev.
 */
export function summarizeProviderContexts(
  provider: MagpieProviderSummary,
  catalogModels: readonly MagpieModel[],
): ProviderContextEntry[] {
  const contexts = provider.contexts ?? {};
  return provider.models.map(modelId => {
    const manual = manualContext(contexts, modelId);
    const auto =
      manual === undefined ? catalogContext(provider.id, modelId, catalogModels) : undefined;
    const tokens = manual ?? auto;
    if (tokens === undefined) return { modelId, source: 'unset' as const };
    return {
      modelId,
      tokens,
      source: provider.isHostManaged
        ? ('system' as const)
        : manual !== undefined
          ? ('manual' as const)
          : ('auto' as const),
    };
  });
}

function manualContext(contexts: Record<string, number>, modelId: string): number | undefined {
  const own = contexts[modelId];
  if (typeof own === 'number' && own > 0) return own;
  const all = contexts['*'];
  return typeof all === 'number' && all > 0 ? all : undefined;
}

function catalogContext(
  providerId: string,
  modelId: string,
  catalogModels: readonly MagpieModel[],
): number | undefined {
  // Catalog ids are `providerId/modelId`; never borrow another provider's
  // window when two providers expose the same model id.
  const owned = catalogModels.filter(
    model => model.id.startsWith(`${providerId}/`) || model.owned_by === providerId,
  );
  const pool =
    owned.length > 0
      ? owned
      : catalogModels.filter(model => model.id === modelId && !model.owned_by);
  const exact = pool.filter(model => model.id === modelId);
  const candidates =
    exact.length > 0 ? exact : pool.filter(model => model.id.endsWith(`/${modelId}`));
  const windows = new Set(
    candidates
      .map(model => model.context_window)
      .filter((window): window is number => typeof window === 'number' && window > 0),
  );
  return windows.size === 1 ? [...windows][0] : undefined;
}
