import type { MagpieProviderSummary } from '../../shared/magpie/types';

export function getMagpieProviderName(
  owner: string | undefined,
  providers: readonly Pick<MagpieProviderSummary, 'id' | 'name'>[],
): string | undefined {
  return providers.find(provider => provider.id === owner)?.name.trim() || owner;
}
