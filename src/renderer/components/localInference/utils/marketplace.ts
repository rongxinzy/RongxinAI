import type { LlamaCppInstallProgress } from '../../../../shared/llamacpp';
import {
  MarketplaceCapability,
  type MarketplaceModel,
  type MarketplaceSearchParams,
} from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import {
  MARKETPLACE_EXTRA_TALL_PAGE_SIZE,
  MARKETPLACE_EXTRA_TALL_PAGE_SIZE_HEIGHT_BREAKPOINT,
  MARKETPLACE_INITIAL_MODEL_COUNT,
  MARKETPLACE_MIN_PAGE_SIZE,
  MARKETPLACE_PAGE_SIZE,
  MARKETPLACE_PAGE_SIZE_HEIGHT_BREAKPOINT,
  MARKETPLACE_WIDE_PAGE_SIZE,
  MARKETPLACE_WIDE_PAGE_SIZE_HEIGHT_BREAKPOINT,
  MARKETPLACE_WIDE_VIEWPORT_WIDTH_BREAKPOINT,
  MARKETPLACE_SEARCH_MAX_MODEL_COUNT,
} from '../constants';
import type { InstallProgressState } from '../types';

export const MARKETPLACE_GGUF_FORMAT = 'GGUF';

const MARKETPLACE_CAPABILITY_ORDER = [
  MarketplaceCapability.Chat,
  MarketplaceCapability.Reasoning,
  MarketplaceCapability.Code,
  MarketplaceCapability.Vision,
  MarketplaceCapability.Embedding,
] as const;

export function buildMarketplaceSearchParams(input: {
  query: string;
  pageNumber?: number;
}): MarketplaceSearchParams | null {
  const query = input.query.trim();
  if (!query) {
    return { limit: MARKETPLACE_INITIAL_MODEL_COUNT };
  }
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
  return models.filter(model => {
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
    case MarketplaceCapability.Reasoning:
      return i18nService.t('marketplaceFilterTaskReasoning');
    case MarketplaceCapability.Code:
      return i18nService.t('marketplaceFilterTaskCode');
    case MarketplaceCapability.Embedding:
      return i18nService.t('marketplaceFilterTaskEmbedding');
    case MarketplaceCapability.Vision:
      return i18nService.t('marketplaceFilterTaskVision');
    case MarketplaceCapability.Chat:
    default:
      return i18nService.t('marketplaceFilterTaskChat');
  }
}

export function getMarketplaceDisplayName(repoId: string): string {
  const repositoryName = repoId.trim().split('/').at(-1) ?? '';
  return repositoryName.replace(/(?:[-_. ]?gguf)+$/i, '') || repositoryName;
}

export function getMarketplacePublisher(repoId: string): string | null {
  const segments = repoId.trim().split('/');
  return segments.length > 1 && segments[0] ? segments[0] : null;
}

export function getMarketplaceCapabilityTags(
  model: MarketplaceModel,
): MarketplaceModel['capability'][] {
  const capabilities = new Set<MarketplaceModel['capability']>([
    model.capability,
    ...model.tags.filter(isMarketplaceCapability),
  ]);
  return MARKETPLACE_CAPABILITY_ORDER.filter(capability => capabilities.has(capability));
}

export function getMarketplaceRecommendedQuantization(recommendedTag: string): string | null {
  const normalized = recommendedTag.trim();
  return normalized && normalized.toLocaleUpperCase() !== MARKETPLACE_GGUF_FORMAT
    ? normalized
    : null;
}

function isMarketplaceCapability(value: string): value is MarketplaceModel['capability'] {
  return Object.values(MarketplaceCapability).includes(
    value.trim().toLocaleLowerCase() as MarketplaceModel['capability'],
  );
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

export function getMarketplacePageSize(
  viewportHeight = globalThis.innerHeight,
  viewportWidth = globalThis.innerWidth,
): number {
  if (
    viewportWidth >= MARKETPLACE_WIDE_VIEWPORT_WIDTH_BREAKPOINT &&
    viewportHeight >= MARKETPLACE_EXTRA_TALL_PAGE_SIZE_HEIGHT_BREAKPOINT
  ) {
    return MARKETPLACE_EXTRA_TALL_PAGE_SIZE;
  }
  if (
    viewportWidth >= MARKETPLACE_WIDE_VIEWPORT_WIDTH_BREAKPOINT &&
    viewportHeight >= MARKETPLACE_WIDE_PAGE_SIZE_HEIGHT_BREAKPOINT
  ) {
    return MARKETPLACE_WIDE_PAGE_SIZE;
  }
  if (viewportWidth >= MARKETPLACE_WIDE_VIEWPORT_WIDTH_BREAKPOINT) {
    return MARKETPLACE_PAGE_SIZE;
  }
  return viewportHeight >= MARKETPLACE_PAGE_SIZE_HEIGHT_BREAKPOINT
    ? MARKETPLACE_PAGE_SIZE
    : MARKETPLACE_MIN_PAGE_SIZE;
}
