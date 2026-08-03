import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@shared/components/ui/input-group';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@shared/components/ui/skeleton';

import type { MarketplaceModel, MarketplaceSearchParams, MarketplaceTaskFilter } from '../../../../shared/marketplace';
import {
  formatMarketplaceHardwareSummary,
  type MarketplaceHardwareProfile,
} from '../../../../shared/marketplace/scoring';
import { i18nService } from '../../../services/i18n';
import { EmptyState } from '../components/Common';
import { MarketplaceModelCard } from '../components/MarketplaceModelCard';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import {
  localInferenceCompactButtonClass,
  MARKETPLACE_PAGE_SIZE,
  MARKETPLACE_MAX_PAGE_ROWS,
  MARKETPLACE_GRID_COLUMN_COUNT,
} from '../constants';
import type { InstallProgressState } from '../types';
import {
  getInstallableMarketplaceModels,
  getMarketplaceInstallProgress,
} from '../utils/marketplace';
import { isPullInProgress } from '../utils/progress';

type MarketplaceBrowseMode = 'recommended' | 'all';
type MarketplaceResultContext = 'recommended' | 'all' | 'search' | 'category';

export function MarketplacePanel({
  loading,
  models,
  hasSearched,
  marketplaceLoading,
  marketplaceError,
  query,
  installedModelPathMap,
  installProgress,
  hardwareSummary,
  onOpenInstalled,
  onQueryChange,
  onSearch,
  onInstall,
  hardwareSummaryReady,
  totalCount,
  nextPageNumber,
}: {
  loading: boolean;
  models: MarketplaceModel[];
  hasSearched: boolean;
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  query: string;
  installedModelPathMap: Map<string, string>;
  installProgress: InstallProgressState;
  onOpenInstalled: (model: MarketplaceModel) => void;
  onQueryChange: (v: string) => void;
  onSearch: (params?: MarketplaceSearchParams) => void;
  hardwareSummary?: MarketplaceHardwareProfile;
  hardwareSummaryReady: boolean;
  totalCount?: number;
  nextPageNumber?: number;
  onInstall: (model: MarketplaceModel) => Promise<void>;
}) {
  const [installingModelIds, setInstallingModelIds] = useState<Set<string>>(new Set());
  const [taskFilter, setTaskFilter] = useState<MarketplaceTaskFilter>('all');
  const [fitFilter, setFitFilter] = useState<NonNullable<MarketplaceSearchParams['fit']>>('all');
  const [browseMode, setBrowseMode] = useState<MarketplaceBrowseMode>('recommended');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [resultContext, setResultContext] = useState<MarketplaceResultContext>('recommended');
  const [page, setPage] = useState(1);
  const gridColumnCount = MARKETPLACE_GRID_COLUMN_COUNT;
  const pageRef = useRef(page);
  const appliedFilterSignatureRef = useRef<string | null>(null);
  const hasObservedSearchRef = useRef(false);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const installableModels = useMemo(
    () => getInstallableMarketplaceModels(models, installedModelPathMap),
    [installedModelPathMap, models],
  );
  const installedModels = useMemo(
    () => models.filter(model => model.installed),
    [models],
  );
  const pageCount = Math.max(
    1,
    totalCount
      ? Math.ceil(totalCount / MARKETPLACE_PAGE_SIZE)
      : nextPageNumber
        ? nextPageNumber
        : Math.ceil(installableModels.length / MARKETPLACE_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);
  // The cloud endpoint owns pagination, but cap the rendered page as a guard
  // against stale responses or an endpoint that returns more than requested.
  const visibleModels = installableModels.slice(0, MARKETPLACE_PAGE_SIZE);

  useEffect(() => {
    pageRef.current = 1;
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (page > pageCount) {
      pageRef.current = pageCount;
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const handleInstall = async (model: MarketplaceModel) => {
    setInstallingModelIds(prev => new Set(prev).add(model.id));
    try {
      await onInstall(model);
    } finally {
      setInstallingModelIds(prev => {
        const next = new Set(prev);
        next.delete(model.id);
        return next;
      });
    }
  };

  const hasQuery = Boolean(submittedQuery.trim());
  const taskLabel = {
    chat: i18nService.t('marketplaceFilterTaskChat'),
    reasoning: i18nService.t('marketplaceFilterTaskReasoning'),
    code: i18nService.t('marketplaceFilterTaskCode'),
    vision: i18nService.t('marketplaceFilterTaskVision'),
  }[taskFilter as 'chat' | 'reasoning' | 'code' | 'vision'];
  const fitFilterLabel = {
    all: i18nService.t('marketplaceFilterFitAll'),
    recommended: i18nService.t('marketplaceFitExcellent'),
    excellent: i18nService.t('marketplaceFitExcellent'),
    compatible: i18nService.t('marketplaceFitCompatible'),
    // Unreachable: the unsupported filter is removed from the UI; kept for
    // type completeness of the fit filter union.
    unsupported: i18nService.t('marketplaceFitUnsupported'),
  }[fitFilter];
  const resultTitle = resultContext === 'search'
    ? `${i18nService.t('marketplaceResultSearch')}${taskFilter !== 'all' ? ` · ${taskLabel ?? taskFilter}` : ''}`
    : resultContext === 'category'
      ? `${i18nService.t('marketplaceResultCategory')} · ${taskLabel ?? taskFilter}`
      : i18nService.t(resultContext === 'recommended' ? 'marketplaceResultRecommended' : 'marketplaceResultAll');
  // The count reflects models that remain after local device and install-state filtering.
  const resultCount = visibleModels.length;
  const searchParamsForPage = useCallback(
    (pageNumber?: number, queryValue = submittedQuery): MarketplaceSearchParams => ({
      query: queryValue,
      pageNumber,
      limit: MARKETPLACE_PAGE_SIZE,
      task: taskFilter,
      fit: fitFilter,
      // Recommendations stay pinned to the curated cloud list. Device fit is
      // shown on cards but is not a recommendation-page filter.
      featuredOnly:
        !queryValue.trim() &&
        taskFilter === 'all' &&
        browseMode === 'recommended',
    }),
    [browseMode, fitFilter, submittedQuery, taskFilter],
  );
  const handlePageChange = useCallback(
    (nextPage: number) => {
      const boundedPage = Math.min(pageCount, Math.max(1, nextPage));
      pageRef.current = boundedPage;
      setPage(boundedPage);
      onSearch(searchParamsForPage(boundedPage));
    },
    [onSearch, pageCount, searchParamsForPage],
  );
  const filterSignature = `${browseMode}:${taskFilter}:${fitFilter}`;
  const submitSearch = () => {
    const nextQuery = query.trim();
    setSubmittedQuery(nextQuery);
    setResultContext(
      nextQuery ? 'search' : taskFilter !== 'all' ? 'category' : browseMode === 'recommended' ? 'recommended' : 'all',
    );
    appliedFilterSignatureRef.current = filterSignature;
    pageRef.current = 1;
    setPage(1);
    onSearch(searchParamsForPage(1, nextQuery));
  };

  useEffect(() => {
    if (!hasSearched) {
      hasObservedSearchRef.current = false;
      appliedFilterSignatureRef.current = null;
      setSubmittedQuery('');
      setResultContext('recommended');
      return;
    }
    if (!hasObservedSearchRef.current) {
      hasObservedSearchRef.current = true;
      setSubmittedQuery(query.trim());
      setResultContext(query.trim() ? 'search' : taskFilter !== 'all' ? 'category' : browseMode === 'recommended' ? 'recommended' : 'all');
      appliedFilterSignatureRef.current = filterSignature;
      return;
    }
    if (appliedFilterSignatureRef.current === filterSignature) return;
    appliedFilterSignatureRef.current = filterSignature;
    pageRef.current = 1;
    setPage(1);
    setResultContext(hasQuery ? 'search' : taskFilter !== 'all' ? 'category' : browseMode === 'recommended' ? 'recommended' : 'all');
    onSearch(searchParamsForPage(1));
  }, [browseMode, filterSignature, hasQuery, hasSearched, onSearch, query, searchParamsForPage, taskFilter]);

  // Skip over server pages that end up empty after local verified/fit/installed
  // filtering, so pagination never lands on a blank grid.
  useEffect(() => {
    if (marketplaceLoading || !hasSearched) return;
    if (installableModels.length > 0) return;
    if (!nextPageNumber || nextPageNumber <= currentPage) return;
    handlePageChange(nextPageNumber);
  }, [currentPage, handlePageChange, hasSearched, installableModels.length, marketplaceLoading, nextPageNumber]);

  const handleResetFilters = useCallback(() => {
    appliedFilterSignatureRef.current = 'recommended:all:compatible';
    onQueryChange('');
    setSubmittedQuery('');
    setTaskFilter('all');
    setFitFilter('all');
    setBrowseMode('recommended');
    pageRef.current = 1;
    setPage(1);
    setResultContext('recommended');
    onSearch({ query: '', pageNumber: 1, limit: MARKETPLACE_PAGE_SIZE, task: 'all', fit: 'all', featuredOnly: true });
  }, [onQueryChange, onSearch]);

  const installedModelActions = installedModels.length > 0 ? (
    <div className="mx-auto mb-4 flex w-full max-w-6xl flex-wrap items-center gap-2 rounded-xl border border-success/20 bg-success/5 px-3 py-2">
      <span className="mr-1 text-xs font-medium text-foreground">{i18nService.t('marketplaceInstalledNext')}</span>
      {installedModels.slice(0, 4).map(model => (
        <Button key={model.repoId} type="button" size="xs" variant="secondary" onClick={() => onOpenInstalled(model)}>
          {model.name || model.repoId}
          <span className="ml-1 text-[10px] text-muted-foreground">{i18nService.t('marketplaceRun')}</span>
        </Button>
      ))}
    </div>
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div
        className={
          hasSearched
            ? 'flex flex-col gap-3'
            : 'flex min-h-[420px] flex-col items-center justify-center gap-8'
        }
      >
        {!hasSearched ? (
          <div className="w-full max-w-3xl space-y-3 text-center">
            <div className="flex items-center justify-center gap-3">
              <h2 className="text-xl font-semibold text-foreground">
              {i18nService.t('marketplaceTitle')}
              </h2>
            </div>
          </div>
        ) : null}
        <div
          className={
            hasSearched ? 'mx-auto flex w-full max-w-6xl items-center gap-3' : 'w-full'
          }
        >
          <form
            className={`min-w-0 ${hasSearched ? 'flex-1' : 'mx-auto w-full max-w-4xl'}`}
            onSubmit={event => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <div className="flex gap-2">
              <InputGroup
                className={hasSearched ? 'h-9 min-w-0 flex-1' : 'h-12 flex-1 rounded-xl'}
              >
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={event => onQueryChange(event.target.value)}
                  placeholder={i18nService.t('marketplaceSearchPlaceholder')}
                  className={hasSearched ? 'text-xs' : 'h-12 text-base'}
                />
              </InputGroup>
              <Button
                type="submit"
                disabled={marketplaceLoading}
                className={
                  hasSearched
                    ? `${localInferenceCompactButtonClass} self-center`
                    : 'h-12 shrink-0 cursor-pointer self-center px-6'
                }
                variant="outline"
              >
                {marketplaceLoading && (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                )}
                {i18nService.t('marketplaceSearch')}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2.5 rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{resultTitle}</span>
            {hasSearched && !marketplaceLoading && installableModels.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {i18nService.t('marketplaceResultCount').replace('{count}', String(resultCount))}
              </span>
            ) : null}
          </div>
          {!hasQuery ? (
            <div className="flex items-center">
              <div className="flex items-center gap-0.5">
                {(['recommended', 'all'] as const).map(mode => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={
                      browseMode === mode
                        ? 'font-semibold text-foreground'
                        : 'font-normal text-muted-foreground hover:text-foreground'
                    }
                    onClick={() => {
                      setBrowseMode(mode);
                      setFitFilter('all');
                    }}
                  >
                    {i18nService.t(
                      mode === 'recommended' ? 'marketplaceBrowseRecommended' : 'marketplaceBrowseAll',
                    )}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/40 pt-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center">
              <FluidTabs
                aria-label={i18nService.t('marketplaceFilterTask')}
                value={taskFilter}
                onValueChange={value => setTaskFilter(value as MarketplaceTaskFilter)}
                items={[
                  { value: 'all', label: i18nService.t('marketplaceFilterTaskAll') },
                  { value: 'chat', label: i18nService.t('marketplaceFilterTaskChat') },
                  { value: 'reasoning', label: i18nService.t('marketplaceFilterTaskReasoning') },
                  { value: 'code', label: i18nService.t('marketplaceFilterTaskCode') },
                  { value: 'vision', label: i18nService.t('marketplaceFilterTaskVision') },
                ]}
              />
            </div>
            {browseMode === 'all' ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {i18nService.t('marketplaceFilterFit')}
                </span>
                <Select value={fitFilter} onValueChange={value => setFitFilter(value as NonNullable<MarketplaceSearchParams['fit']>)}>
                  <SelectTrigger size="sm" aria-label={i18nService.t('marketplaceFilterFit')} className="min-w-32">
                    <SelectValue>{fitFilterLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="recommended">{i18nService.t('marketplaceFitExcellent')}</SelectItem>
                      <SelectItem value="compatible">{i18nService.t('marketplaceFitCompatible')}</SelectItem>
                      <SelectItem value="all">{i18nService.t('marketplaceFilterFitAll')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {hardwareSummaryReady ? formatMarketplaceHardwareSummary(hardwareSummary) : i18nService.t('marketplaceHardwareDetecting')}
          </span>
        </div>
      </div>

      {marketplaceError ? (
        <Alert>
          <AlertTitle>
            {marketplaceError.startsWith('CATALOG_ERROR:')
              ? i18nService.t('marketplaceSearchStatusCatalogUnavailable')
              : i18nService.t('marketplaceSearchStatusWarning')}
          </AlertTitle>
          <AlertDescription>{marketplaceError.replace(/^(?:CATALOG_ERROR|AUTH_ERROR):\s*/, '')}</AlertDescription>
        </Alert>
      ) : null}

      {marketplaceLoading ? (
        <MarketplaceGridSkeleton columnCount={gridColumnCount} />
      ) : !hasSearched ? null : installableModels.length === 0 ? (
        <div className="flex min-h-[620px] flex-col gap-4">
          {installedModelActions ?? (
            <EmptyState
              title={i18nService.t('marketplaceNoModels')}
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {fitFilter !== 'all' ? (
                    <Button type="button" size="sm" onClick={() => setFitFilter('all')}>
                      {i18nService.t('marketplaceEmptyShowAll')}
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="outline" onClick={handleResetFilters}>
                    {i18nService.t('marketplaceFilterClear')}
                  </Button>
                </div>
              }
            />
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {installedModelActions}
          <div
            className="mx-auto grid w-full max-w-6xl auto-rows-min content-start gap-4"
            style={{ gridTemplateColumns: `repeat(${gridColumnCount}, minmax(0, 1fr))` }}
          >
            {visibleModels.map(model => {
              const progress = getMarketplaceInstallProgress(installProgress, model);
              const installing = installingModelIds.has(model.id) || isPullInProgress(progress);
              return (
                <MarketplaceModelCard
                  key={model.repoId || model.id}
                  model={model}
                  loading={loading}
                  installing={installing}
                  installProgress={installProgress}
                  onInstall={handleInstall}
                />
              );
            })}
          </div>
          {hasSearched && installableModels.length > 0 && (
            <div
              className="mt-auto flex items-center justify-center gap-5 border-t border-border-subtle bg-background px-3 py-3"
            >
              <Button
                type="button"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                variant="ghost"
                size="icon-sm"
                aria-label={i18nService.t('skillMarketplacePrevPage')}
                title={i18nService.t('skillMarketplacePrevPage')}
              >
                <ChevronLeft />
              </Button>
              <span className="inline-flex h-7 items-center justify-center text-sm text-foreground">
                {i18nService
                  .t('marketplacePageSummary')
                  .replace('{page}', String(currentPage))
                  .replace('{total}', String(pageCount))}
              </span>
              <Button
                type="button"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= pageCount}
                variant="ghost"
                size="icon-sm"
                aria-label={i18nService.t('skillMarketplaceNextPage')}
                title={i18nService.t('skillMarketplaceNextPage')}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// In-place loading placeholder that mirrors the model card grid, so the first
// paint of a search never flashes a centered spinner (DESIGN.md: skeletons,
// not full-screen spinners).
function MarketplaceGridSkeleton({ columnCount }: { columnCount: number }) {
  return (
    <div
      aria-hidden="true"
      className="mx-auto grid w-full max-w-6xl auto-rows-min content-start gap-4"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: columnCount * MARKETPLACE_MAX_PAGE_ROWS }, (_, index) => (
        <div
          key={index}
          className="flex h-full flex-col gap-3 rounded-lg border border-border/70 bg-card p-4 shadow-sm"
        >
          <div className="flex items-center gap-2">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="h-5 w-2/3" />
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-6 w-14 rounded-md" />
            <Skeleton className="h-6 w-10 rounded-md" />
            <Skeleton className="h-6 w-12 rounded-md" />
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-border/50 pt-3">
            <Skeleton className="h-5 w-16 rounded-md" />
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}
