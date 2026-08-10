import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@shared/components/ui/input-group';
import { ChevronLeft, ChevronRight, Monitor, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Skeleton } from '@shared/components/ui/skeleton';

import { MarketplaceSortOrder, type MarketplaceModel, type MarketplaceSearchParams, type MarketplaceTaskFilter } from '../../../../shared/marketplace';
import {
  formatMarketplaceHardwareSummaryParts,
  type MarketplaceHardwareProfile,
} from '../../../../shared/marketplace/scoring';
import { i18nService } from '../../../services/i18n';
import { EmptyState } from '../components/Common';
import { MarketplaceModelCard } from '../components/MarketplaceModelCard';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Separator } from '@shared/components/ui/separator';
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
  MARKETPLACE_GRID_COLUMN_COUNT,
} from '../constants';
import type { InstallProgressState } from '../types';
import {
  getInstallableMarketplaceModels,
  getMarketplaceInstallProgress,
} from '../utils/marketplace';
import { isPullInProgress } from '../utils/progress';

export function MarketplacePanel({
  loading,
  models,
  hasSearched,
  marketplaceLoading,
  marketplaceError,
  totalCount,
  hasNextPage,
  query,
  installedModelPathMap,
  installProgress,
  hardwareSummary,
  onOpenInstalled,
  onQueryChange,
  onSearch,
  onInstall,
  hardwareSummaryReady,
}: {
  loading: boolean;
  models: MarketplaceModel[];
  hasSearched: boolean;
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  totalCount?: number;
  hasNextPage: boolean;
  query: string;
  installedModelPathMap: Map<string, string>;
  installProgress: InstallProgressState;
  onOpenInstalled: (model: MarketplaceModel) => void;
  onQueryChange: (v: string) => void;
  onSearch: (params?: MarketplaceSearchParams) => void;
  hardwareSummary?: MarketplaceHardwareProfile;
  hardwareSummaryReady: boolean;
  onInstall: (model: MarketplaceModel) => Promise<void>;
}) {
  const [installingModelIds, setInstallingModelIds] = useState<Set<string>>(new Set());
  const [taskFilter, setTaskFilter] = useState<MarketplaceTaskFilter>('all');
  const [fitFilter, setFitFilter] = useState<NonNullable<MarketplaceSearchParams['fit']>>('all');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(1);
  const gridColumnCount = MARKETPLACE_GRID_COLUMN_COUNT;
  const marketplaceGridViewportRef = useRef<HTMLDivElement>(null);
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


  const showAllModels = fitFilter === 'all';
  const pageCount = Math.max(
    1,
    totalCount ? Math.ceil(totalCount / MARKETPLACE_PAGE_SIZE) : hasNextPage ? page + 1 : page,
  );
  const currentPage = page;
  const visibleModels = showAllModels ? models : installableModels;
  const hardwareSummaryParts = formatMarketplaceHardwareSummaryParts(hardwareSummary);
  const hardwareGpuValue = hardwareSummaryParts.gpuCount > 0
    ? `${hardwareSummaryParts.gpuCount} · ${hardwareSummaryParts.totalVramGiB}GB${hardwareSummaryParts.gpuNames.length > 0 ? ` ${hardwareSummaryParts.gpuNames.join(' / ')}` : ''}`
    : i18nService.t('marketplaceHardwareNotDetected');
  const hardwareMemoryValue = hardwareSummaryParts.systemMemoryGiB !== null
    ? `${hardwareSummaryParts.systemMemoryGiB}GB`
    : i18nService.t('marketplaceHardwareNotDetected');

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

  const fitFilterLabel = {
    all: i18nService.t('marketplaceFilterFitAll'),
    recommended: i18nService.t('marketplaceFitExcellent'),
    excellent: i18nService.t('marketplaceFitExcellent'),
    compatible: i18nService.t('marketplaceFitCompatible'),
    // Unreachable: the unsupported filter is removed from the UI; kept for
    // type completeness of the fit filter union.
    unsupported: i18nService.t('marketplaceFitUnsupported'),
  }[fitFilter];
  const searchParamsForPage = useCallback(
    (queryValue = submittedQuery, pageNumber = 1): MarketplaceSearchParams => {
      return {
        query: queryValue,
        pageNumber,
        limit: MARKETPLACE_PAGE_SIZE,
        task: taskFilter,
        fit: fitFilter,
        sortby: MarketplaceSortOrder.Asc,
        featuredOnly: false,
      };
    },
    [fitFilter, submittedQuery, taskFilter],
  );

  const handlePageChange = useCallback(
    (nextPage: number) => {
      if (marketplaceLoading) return;
      const boundedPage = Math.min(pageCount, Math.max(1, nextPage));
      pageRef.current = boundedPage;
      setPage(boundedPage);
      onSearch(searchParamsForPage(submittedQuery, boundedPage));
    },
    [marketplaceLoading, onSearch, pageCount, searchParamsForPage, submittedQuery],
  );
  const filterSignature = `${taskFilter}:${fitFilter}`;
  const submitSearch = () => {
    const nextQuery = query.trim();
    setSubmittedQuery(nextQuery);
    appliedFilterSignatureRef.current = filterSignature;
    pageRef.current = 1;
    setPage(1);
    onSearch(searchParamsForPage(nextQuery));
  };

  useEffect(() => {
    if (!hasSearched) {
      hasObservedSearchRef.current = false;
      appliedFilterSignatureRef.current = null;
      setSubmittedQuery('');
      return;
    }
    if (!hasObservedSearchRef.current) {
      hasObservedSearchRef.current = true;
      setSubmittedQuery(query.trim());
      appliedFilterSignatureRef.current = filterSignature;
      return;
    }
    if (appliedFilterSignatureRef.current === filterSignature) return;
    appliedFilterSignatureRef.current = filterSignature;
    pageRef.current = 1;
    setPage(1);
    onSearch(searchParamsForPage());
  }, [filterSignature, hasSearched, onSearch, query, searchParamsForPage]);

  const handleResetFilters = useCallback(() => {
    appliedFilterSignatureRef.current = 'all:all';
    onQueryChange('');
    setSubmittedQuery('');
    setTaskFilter('all');
    setFitFilter('all');
    pageRef.current = 1;
    setPage(1);
    onSearch({
      query: '',
      task: 'all',
      fit: 'all',
      sortby: MarketplaceSortOrder.Asc,
      limit: MARKETPLACE_PAGE_SIZE,
      pageNumber: 1,
      featuredOnly: false,
    });
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
      <div className="flex flex-col gap-3">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
          <form
            className="min-w-0 flex-1"
            onSubmit={event => {
              event.preventDefault();
              if (marketplaceLoading) return;
              submitSearch();
            }}
          >
            <div className="flex gap-2">
              <InputGroup className="h-9 min-w-0 flex-1">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={event => onQueryChange(event.target.value)}
                  placeholder={i18nService.t('marketplaceSearchPlaceholder')}
                  className="text-xs"
                />
              </InputGroup>
              <Button
                type="submit"
                aria-disabled={marketplaceLoading}
                className={`${localInferenceCompactButtonClass} self-center`}
                variant="outline"
              >
                <RefreshCw
                  data-icon="inline-start"
                />
                {i18nService.t('marketplaceSearch')}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-3 rounded-lg bg-background p-1">
      <div className="flex w-full shrink-0 flex-col gap-3 px-4 py-3">
        <div className="flex w-full flex-wrap items-stretch justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            <div className="shrink-0">
              <FluidTabs
                className="w-fit max-w-full"
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
            <div className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-muted/80 p-1">
                <span className="px-2 text-sm leading-5 font-normal text-muted-foreground">
                  {i18nService.t('marketplaceFilterFit')}
                </span>
                <Select value={fitFilter} onValueChange={value => setFitFilter(value as NonNullable<MarketplaceSearchParams['fit']>)}>
                  <SelectTrigger size="sm" aria-label={i18nService.t('marketplaceFilterFit')} className="min-w-32 border-border-subtle bg-surface">
                    <SelectValue className="font-semibold text-foreground">{fitFilterLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    side="bottom"
                    sideOffset={4}
                    alignItemWithTrigger={false}
                    collisionAvoidance={{ side: 'none', align: 'shift', fallbackAxisSide: 'none' }}
                  >
                    <SelectGroup>
                      <SelectItem value="recommended">{i18nService.t('marketplaceFitExcellent')}</SelectItem>
                      <SelectItem value="compatible">{i18nService.t('marketplaceFitCompatible')}</SelectItem>
                      <SelectItem value="all">{i18nService.t('marketplaceFilterFitAll')}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
            </div>
          </div>
          <div className="inline-flex h-10 w-fit min-w-0 max-w-full items-center gap-2 rounded-lg border border-success/25 bg-success/10 px-4 text-sm leading-5 text-success">
            <Monitor className="size-5 shrink-0" aria-hidden="true" />
            {hardwareSummaryReady ? (
              <span className="inline-flex min-w-0 max-w-full items-center gap-2">
                <span className="min-w-0 truncate">
                  {i18nService.t('marketplaceHardwareGpuLabel')} {hardwareGpuValue}
                </span>
                <Separator orientation="vertical" className="h-6 w-px bg-success/60" aria-hidden="true" />
                <span className="shrink-0 whitespace-nowrap">
                  {i18nService.t('marketplaceHardwareMemoryLabel')} {hardwareMemoryValue}
                </span>
              </span>
            ) : (
              <span>{i18nService.t('marketplaceHardwareDetecting')}</span>
            )}
          </div>
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

      {marketplaceLoading && models.length === 0 ? (
        <div ref={marketplaceGridViewportRef} className="relative mx-auto min-h-0 w-full max-w-6xl flex-1 overflow-y-auto overflow-x-hidden scrollbar-gutter-stable rounded-lg bg-surface p-1">
          <MarketplaceGridSkeleton columnCount={gridColumnCount} pageSize={MARKETPLACE_PAGE_SIZE} />
        </div>
      ) : !hasSearched ? null : visibleModels.length === 0 ? (
        <div className="mx-auto flex min-h-[620px] w-full max-w-6xl flex-col gap-4 rounded-lg bg-surface p-1">
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
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col rounded-lg bg-surface p-1">
          {installedModelActions}
          <div ref={marketplaceGridViewportRef} className="relative mx-auto min-h-0 w-full max-w-6xl flex-1 overflow-y-auto overflow-x-hidden scrollbar-gutter-stable rounded-lg bg-surface p-1">
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
          </div>

        </div>
      )}
      </div>

      {hasSearched && visibleModels.length > 0 && (
            <div
              className="mx-auto mt-auto flex w-full max-w-6xl items-center justify-center gap-5 bg-background px-3 py-3"
            >
              <Button
                type="button"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={marketplaceLoading || currentPage <= 1}
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
                disabled={marketplaceLoading || !hasNextPage || currentPage >= pageCount}
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
  );
}

// In-place loading placeholder that mirrors the model card grid, so the first
// paint of a search never flashes a centered spinner (DESIGN.md: skeletons,
// not full-screen spinners).
function MarketplaceGridSkeleton({ columnCount, pageSize }: { columnCount: number; pageSize: number }) {
  return (
    <div
      aria-hidden="true"
      className="mx-auto grid w-full max-w-6xl auto-rows-min content-start gap-4"
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: pageSize }, (_, index) => (
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
