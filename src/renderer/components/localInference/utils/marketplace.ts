import type { LlamaCppInstallProgress } from '../../../../shared/llamacpp';
import {
  MarketplaceCapability,
  type MarketplaceModel,
  type MarketplaceModelFile,
  type MarketplaceSearchParams,
} from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import {
  MARKETPLACE_INITIAL_MODEL_COUNT,
  MARKETPLACE_MAX_PAGE_ROWS,
  MARKETPLACE_PAGE_SIZE,
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
  task?: MarketplaceSearchParams['task'];
  size?: MarketplaceSearchParams['size'];
  device?: MarketplaceSearchParams['device'];
  fit?: MarketplaceSearchParams['fit'];
  minStars?: number;
  featuredOnly?: boolean;
  limit?: number;
}): MarketplaceSearchParams | null {
  const query = input.query.trim();
  const limit =
    input.limit ??
    (query ? MARKETPLACE_SEARCH_MAX_MODEL_COUNT : MARKETPLACE_INITIAL_MODEL_COUNT);
  if (!query) {
    return {
      limit,
      pageNumber: input.pageNumber,
      device: input.device,
      // Empty marketplace browsing uses the full catalogue and local fit scoring.
      // Task categories add their own catalogue filter.
      featuredOnly: input.featuredOnly ?? false,
      task: input.task,
      size: input.size,
      fit: input.fit ?? 'all',
      minStars: input.minStars,
    };
  }
  if (!isMarketplaceSearchQuery(query)) return null;
  return {
    query,
    limit,
    pageNumber: input.pageNumber,
    device: input.device,
    task: input.task,
    size: input.size,
    fit: input.fit,
    minStars: input.minStars,
  };
}

export function formatMarketplaceScore(stars?: number, confidence?: string): string {
  if (!stars || stars <= 0) return i18nService.t('marketplaceScoreUnavailable');
  return `${stars.toFixed(1)}${confidence ? ` · ${confidence}` : ''}`;
}

export function marketplaceFitLabel(status?: NonNullable<MarketplaceModel['fit']>['status']): string {
  switch (status) {
    case 'excellent': return i18nService.t('marketplaceFitExcellent');
    case 'good': return i18nService.t('marketplaceFitGood');
    case 'limited': return i18nService.t('marketplaceFitLimited');
    case 'unsupported': return i18nService.t('marketplaceFitUnsupported');
    default: return i18nService.t('marketplaceFitUnknown');
  }
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
  const seenModelKeys = new Set<string>();
  return models.filter(model => {
    const modelKey = model.repoId.trim() || model.id.trim();
    if (!modelKey || seenModelKeys.has(modelKey)) return false;
    seenModelKeys.add(modelKey);

    const installedModelName = model.installedPath
      ? installedModelPathMap.get(model.installedPath)
      : undefined;
    return !model.installed && !installedModelName;
  });
}

export function filterMarketplaceModelsForRecommendation(
  models: MarketplaceModel[],
): MarketplaceModel[] {
  return models.filter(model => {
    const status = model.fit?.status ?? 'unknown';
    return status === 'excellent' || status === 'good' || status === 'limited';
  });
}
export function filterMarketplaceModelsForDevice(
  models: MarketplaceModel[],
  fit: MarketplaceSearchParams['fit'],
  minStars?: number,
): MarketplaceModel[] {
  return models
    .filter(model => !minStars || (model.score?.stars ?? 0) >= minStars)
    .filter(model => {
      const status = model.fit?.status ?? 'unknown';
      switch (fit) {
        case 'recommended':
          return status === 'excellent' || status === 'good' || status === 'limited';
        case 'excellent':
          return status === 'excellent';
        case 'compatible':
          return status === 'excellent' || status === 'good' || status === 'limited' || status === 'unknown';
        case 'unsupported':
          // The explicit unsupported filter is removed from the UI; kept for
          // type completeness of the fit filter union.
          return false;
        case 'all':
        default:
          // "不限" lists every GGUF model, including ones this device cannot
          // run — the card marks them as not fitting so the choice stays
          // honest while the directory stays complete. Unknown (hardware not
          // detected) is always visible so a healthy default never collapses.
          return true;
      }
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
    ...(model.capabilities ?? []),
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

export function getMarketplacePageSize({
  availableGridHeight,
  cardHeight,
  columnCount,
  rowGap,
}: {
  availableGridHeight: number;
  cardHeight: number;
  columnCount: number;
  rowGap: number;
}): number {
  if (
    !Number.isFinite(availableGridHeight) ||
    !Number.isFinite(cardHeight) ||
    !Number.isFinite(columnCount) ||
    !Number.isFinite(rowGap) ||
    availableGridHeight <= 0 ||
    cardHeight <= 0 ||
    columnCount <= 0
  ) {
    return MARKETPLACE_PAGE_SIZE;
  }

  const rows = Math.min(
    MARKETPLACE_MAX_PAGE_ROWS,
    Math.max(1, Math.floor((availableGridHeight + rowGap) / (cardHeight + rowGap))),
  );
  return rows * Math.floor(columnCount);
}

export function getMarketplaceGridColumnCount({
  gridWidth,
  cardWidth,
  columnGap,
}: {
  gridWidth: number;
  cardWidth: number;
  columnGap: number;
}): number {
  if (
    !Number.isFinite(gridWidth) ||
    !Number.isFinite(cardWidth) ||
    !Number.isFinite(columnGap) ||
    gridWidth <= 0 ||
    cardWidth <= 0
  ) {
    return 1;
  }

  return Math.max(1, Math.round((gridWidth + columnGap) / (cardWidth + columnGap)));
}

const GGUF_SHARD_PATTERN = /-\d{5}-of-\d{5}\.gguf$/i;
const GGUF_MMPROJ_PATTERN = /(?:^|[/_.-])mmproj(?:[/_.-]|$)/i;
const QUANTIZATION_PATTERN =
  /(?:^|[-_.])(q[234568](?:_[0-9]+)?(?:_[kmst](?:_?[sml])?)?|iq[1-4]_[a-z0-9]+|f16|f32)(?:[-_.]|$)/i;

export type MarketplaceVariant = {
  id: string;
  quantization: string | null;
  files: MarketplaceModelFile[];
  totalSizeBytes: number;
  isSplit: boolean;
  isRecommended: boolean;
};

export function extractQuantization(filePath: string): string | null {
  const base = filePath.split('/').at(-1) ?? filePath;
  return base.match(QUANTIZATION_PATTERN)?.[1]?.toUpperCase() ?? null;
}

function shardGroupKey(filePath: string): string | null {
  const match = filePath.match(/^(.*?)-?\d{5}-of-\d{5}\.gguf$/i);
  return match ? match[1] : null;
}

/**
 * Groups a repo's GGUF files into installable variants. Standalone files are
 * one variant each; split-GGUF repos (a quantization sharded into
 * `-00001-of-N.gguf` parts, e.g. unsloth directory layouts or QwQ-32B) become
 * one variant per part group — installing a split variant downloads every part
 * so llama.cpp can load the sharded model. mmproj files are excluded: they are
 * downloaded automatically alongside a vision model, never installed alone.
 */
export function groupMarketplaceVariants(
  files: MarketplaceModelFile[] | undefined,
): MarketplaceVariant[] {
  if (!files?.length) return [];
  const shardGroups = new Map<string, MarketplaceModelFile[]>();
  const standalone: MarketplaceModelFile[] = [];
  for (const file of files) {
    if (GGUF_MMPROJ_PATTERN.test(file.path)) continue;
    if (GGUF_SHARD_PATTERN.test(file.path)) {
      const key = shardGroupKey(file.path);
      if (!key) continue;
      const group = shardGroups.get(key) ?? [];
      group.push(file);
      shardGroups.set(key, group);
      continue;
    }
    standalone.push(file);
  }
  const variants: MarketplaceVariant[] = standalone.map(file => ({
    id: file.path,
    quantization: extractQuantization(file.path),
    files: [file],
    totalSizeBytes: file.sizeBytes ?? 0,
    isSplit: false,
    isRecommended: Boolean(file.isRecommended),
  }));
  for (const [key, group] of shardGroups) {
    const sorted = [...group].sort((left, right) =>
      left.path.localeCompare(right.path, undefined, { numeric: true }),
    );
    variants.push({
      id: key,
      quantization: extractQuantization(key.split('/').at(-1) ?? key),
      files: sorted,
      totalSizeBytes: group.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0),
      isSplit: true,
      isRecommended: sorted.some(file => file.isRecommended),
    });
  }
  const preferences = ['Q4_K_M', 'Q5_K_M', 'Q5_0', 'Q4_0', 'Q6_K', 'Q8_0'];
  const preferenceRank = (variant: MarketplaceVariant): number => {
    const index = preferences.indexOf((variant.quantization ?? '').toUpperCase());
    return index === -1 ? preferences.length : index;
  };
  variants.sort((left, right) => {
    if (left.isRecommended !== right.isRecommended) return left.isRecommended ? -1 : 1;
    const rankDelta = preferenceRank(left) - preferenceRank(right);
    if (rankDelta !== 0) return rankDelta;
    return left.totalSizeBytes - right.totalSizeBytes;
  });
  return variants;
}
