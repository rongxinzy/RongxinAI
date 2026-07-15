import type { LlamaCppInstallProgress } from '../../../../shared/llamacpp';
import type { MarketplaceModel, MarketplaceSearchParams } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import { MARKETPLACE_PAGE_SIZE, MARKETPLACE_SEARCH_MAX_MODEL_COUNT } from '../constants';
import type { InstallProgressState } from '../types';

export function buildMarketplaceSearchParams(input: {
  query: string;
  pageNumber?: number;
}): MarketplaceSearchParams | null {
  const query = input.query.trim();
  if (!isMarketplaceSearchQuery(query)) return null;
  return {
    query,
    limit: MARKETPLACE_SEARCH_MAX_MODEL_COUNT,
    pageNumber: input.pageNumber,
  };
}

function isMarketplaceSearchQuery(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value.trim());
}

export function isModelScopeRepoId(value: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(value.trim());
}

export function getInstallableMarketplaceModels(
  models: MarketplaceModel[],
  installedModelPathMap: Map<string, string>,
): MarketplaceModel[] {
  return models.filter((model) => {
    const installedModelName = model.installedPath
      ? installedModelPathMap.get(model.installedPath)
      : undefined;
    return !model.installed && !installedModelName;
  });
}

export function getMarketplaceInstallProgress(
  progress: InstallProgressState,
  model: Pick<MarketplaceModel, 'id' | 'repoId'>,
): LlamaCppInstallProgress | undefined {
  // ModelScope emits repo IDs, while other marketplace sources may emit model IDs.
  return progress[model.repoId] ?? progress[model.id];
}

export function capabilityLabel(capability: MarketplaceModel['capability']): string {
  switch (capability) {
    case 'reasoning':
      return i18nService.t('marketplaceFilterTaskReasoning');
    case 'code':
      return i18nService.t('marketplaceFilterTaskCode');
    case 'embedding':
      return i18nService.t('marketplaceFilterTaskEmbedding');
    case 'vision':
      return i18nService.t('marketplaceFilterTaskVision');
    case 'chat':
    default:
      return i18nService.t('marketplaceFilterTaskChat');
  }
}

export async function openExternalUrl(url: string): Promise<void> {
  const result = await window.electron.shell.openExternal(url);
  if (!result.success) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function formatDownloadCount(downloads?: number): string {
  if (!downloads || downloads <= 0) return '';
  const value =
    downloads >= 1_000_000
      ? `${(downloads / 1_000_000).toFixed(downloads >= 10_000_000 ? 0 : 1)}M`
      : downloads >= 1_000
        ? `${(downloads / 1_000).toFixed(downloads >= 100_000 ? 0 : 1)}k`
        : String(downloads);
  return i18nService.t('marketplaceDownloads').replace('{count}', value);
}

export function getMarketplacePageSize(): number {
  return MARKETPLACE_PAGE_SIZE;
}
