import {
  MarketplaceCapability,
  MarketplaceSortOrder,
  type MarketplaceModel,
  type MarketplaceSearchParams,
} from '../../shared/marketplace';

const MarketplaceModelSizeTier = {
  Compact: 0,
  Dual8GbFriendly: 1,
  MidRange: 2,
  Workstation: 3,
  Large: 4,
  Unknown: 5,
} as const;

const COMPACT_MODEL_MAX_PARAMETERS = 4_000_000_000;
const DUAL_8GB_MODEL_MAX_PARAMETERS = 8_000_000_000;
const MID_RANGE_MODEL_MAX_PARAMETERS = 16_000_000_000;
const WORKSTATION_MODEL_MAX_PARAMETERS = 32_000_000_000;

export function sortMarketplaceModels(
  models: MarketplaceModel[],
  params: MarketplaceSearchParams,
): MarketplaceModel[] {
  const emptyQuery = !params.query?.trim();
  return [...models].sort((a, b) => {
    if (params.sortby) {
      const leftParameters = resolveMarketplaceParameterCount(a) ?? Number.MAX_SAFE_INTEGER;
      const rightParameters = resolveMarketplaceParameterCount(b) ?? Number.MAX_SAFE_INTEGER;
      const parameterDiff = leftParameters - rightParameters;
      if (parameterDiff !== 0) {
        return params.sortby === MarketplaceSortOrder.Desc ? -parameterDiff : parameterDiff;
      }
    }

    if (emptyQuery) {
      const featuredRankDiff = getFeaturedRank(a) - getFeaturedRank(b);
      if (featuredRankDiff !== 0) return featuredRankDiff;
    }

    const sizeTierDiff = getMarketplaceModelSizeTier(a) - getMarketplaceModelSizeTier(b);
    if (sizeTierDiff !== 0) return sizeTierDiff;

    if (a.installed !== b.installed) {
      return a.installed ? -1 : 1;
    }

    const capabilityDiff = capabilityScore(b.capability) - capabilityScore(a.capability);
    if (capabilityDiff !== 0 && params.task === MarketplaceCapability.Reasoning) {
      return capabilityDiff;
    }

    if (a.isFeatured !== b.isFeatured) {
      return a.isFeatured ? -1 : 1;
    }

    const downloadsDiff = (b.downloads ?? 0) - (a.downloads ?? 0);
    if (downloadsDiff !== 0) return downloadsDiff;

    const parametersDiff =
      (resolveMarketplaceParameterCount(a) ?? Number.MAX_SAFE_INTEGER) -
      (resolveMarketplaceParameterCount(b) ?? Number.MAX_SAFE_INTEGER);
    if (parametersDiff !== 0) return parametersDiff;

    return a.repoId.localeCompare(b.repoId);
  });
}

export function resolveMarketplaceParameterCount(
  model: Pick<MarketplaceModel, 'parameterCount' | 'sizes'>,
): number | null {
  if (typeof model.parameterCount === 'number' && Number.isFinite(model.parameterCount)) {
    return model.parameterCount;
  }
  return resolveParameterCount(model.sizes) ?? null;
}

export function resolveParameterCount(sizes: string[]): number | undefined {
  for (const size of sizes) {
    const match = size.trim().match(/^(\d+(?:\.\d+)?)\s*B$/i);
    if (!match) continue;
    const count = Number(match[1]);
    if (Number.isFinite(count)) return count * 1_000_000_000;
  }
  return undefined;
}

function getMarketplaceModelSizeTier(model: MarketplaceModel): number {
  const parameterCount = resolveMarketplaceParameterCount(model);
  if (parameterCount === null) return MarketplaceModelSizeTier.Unknown;
  if (parameterCount <= COMPACT_MODEL_MAX_PARAMETERS) return MarketplaceModelSizeTier.Compact;
  if (parameterCount <= DUAL_8GB_MODEL_MAX_PARAMETERS)
    return MarketplaceModelSizeTier.Dual8GbFriendly;
  if (parameterCount <= MID_RANGE_MODEL_MAX_PARAMETERS) return MarketplaceModelSizeTier.MidRange;
  if (parameterCount <= WORKSTATION_MODEL_MAX_PARAMETERS)
    return MarketplaceModelSizeTier.Workstation;
  return MarketplaceModelSizeTier.Large;
}

function getFeaturedRank(model: MarketplaceModel): number {
  return model.featuredRank ?? Number.MAX_SAFE_INTEGER;
}

function capabilityScore(capability: MarketplaceModel['capability']): number {
  switch (capability) {
    case MarketplaceCapability.Reasoning:
      return 5;
    case MarketplaceCapability.Code:
      return 4;
    case MarketplaceCapability.Vision:
      return 3;
    case MarketplaceCapability.Embedding:
      return 2;
    case MarketplaceCapability.Chat:
    default:
      return 1;
  }
}
