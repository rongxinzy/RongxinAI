import type { MarketplaceModel } from '../../shared/marketplace';

/**
 * Resolves the catalogue parameter count in billions of parameters.
 * `sizes` is a device-fit tier in the catalogue contract and must not be
 * interpreted as a parameter count.
 */
export function resolveMarketplaceParameterCount(
  model: Pick<MarketplaceModel, 'parameterCount'>,
): number | null {
  if (typeof model.parameterCount !== 'number' || !Number.isFinite(model.parameterCount)) {
    return null;
  }
  return model.parameterCount > 0 ? model.parameterCount : null;
}
