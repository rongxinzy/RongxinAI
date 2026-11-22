import { AISphere } from '../../shared/aisphere';
import type { MagpieProviderSummary } from '../../shared/magpie/types';
import { neutralRuntimeName } from './runtimeNameNeutralizer';

export function getMagpieProviderName(
  owner: string | undefined,
  providers: readonly Pick<MagpieProviderSummary, 'id' | 'name'>[],
): string | undefined {
  const matched = providers.find(provider => provider.id === owner)?.name.trim();
  if (matched) return neutralRuntimeName(matched);
  if (owner?.startsWith(AISphere.HostProviderPrefix)) return 'AISphere';
  return owner ? neutralRuntimeName(owner) : owner;
}
