import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@shared/components/ui/input-group';
import { Monitor, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MarketplaceModelCardSkeleton } from '../components/MarketplaceCardLayout';

import { type MarketplaceModel, type MarketplaceSearchParams, type MarketplaceTaskFilter } from '../../../../shared/marketplace';
import {
  formatMarketplaceHardwareSummaryParts,
  type MarketplaceHardwareProfile,
} from '../../../../shared/marketplace/scoring';
import { i18nService } from '../../../services/i18n';
import { EmptyState } from '../components/Common';
import { MarketplaceModelCard } from '../components/MarketplaceModelCard';
import { FluidTabs, FluidTabsSize } from '@shared/components/ui/fluid-tabs';
import { Separator } from '@shared/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { ListPagination } from '../../common/ListPagination';
import {
  localInferenceCompactButtonClass,
  MARKETPLACE_PAGE_SIZE,
} from '../constants';
import {
  getInstallableMarketplaceModels,
} from '../utils/marketplace';

const marketplaceGridClassName = 'grid w-full grid-cols-1 auto-rows-min content-start gap-4 @3xl/marketplace:grid-cols-2';

export function MarketplacePanel({
  loading,
  models,
  hasSearched,
  marketplaceLoading,
  marketplaceError,
  totalCount,
  hasNextPage,
  initialQuery = '',
  installedModelPathMap,
  hardwareSummary,
  activeDownloadModelId,
  onQueryChange,
  onSearch,
  onInstall,
  onOpenDownloadPanel,
  hardwareSummaryReady,
}: {
  loading: boolean;
  models: MarketplaceModel[];
  hasSearched: boolean;
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  totalCount?: number;
  hasNextPage: boolean;
  // Mount-time value only; the panel owns the query state afterwards so typing
  // does not re-render the whole view. onQueryChange still notifies the parent.
  initialQuery?: string;
  installedModelPathMap: Map<string, string>;
  onQueryChange: (v: string) => void;
  onSearch: (params?: MarketplaceSearchParams) => void;
  hardwareSummary?: MarketplaceHardwareProfile;
  hardwareSummaryReady: boolean;
  onInstall: (model: MarketplaceModel) => Promise<void>;
  activeDownloadModelId?: string;
  onOpenDownloadPanel: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [taskFilter, setTaskFilter] = useState<MarketplaceTaskFilter>('all');
  const [fitFilter, setFitFilter] = useState<NonNullable<MarketplaceSearchParams['fit']>>('all');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [page, setPage] = useState(1);
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

  const handleQueryChange = (value: string) => {
    setQuery(value);
    onQueryChange(value);
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
    setQuery('');
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
      limit: MARKETPLACE_PAGE_SIZE,
      pageNumber: 1,
      featuredOnly: false,
    });
  }, [onQueryChange, onSearch]);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-3">
      <form
        className="w-full"
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
              onChange={event => handleQueryChange(event.target.value)}
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

      <div className="flex w-full shrink-0 flex-wrap items-stretch justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="shrink-0">
            <FluidTabs
              className="w-fit max-w-full"
              inactiveTabClassName="hover:opacity-100"
              listClassName="border border-border-subtle"
              showInactiveHoverIndicator
              size={FluidTabsSize.Default}
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
          <div className="inline-flex h-10 items-center gap-1 rounded-lg border border-border-subtle bg-muted/80 px-1 py-0.5">
              <span className="px-2 text-sm leading-5 font-normal text-muted-foreground">
                {i18nService.t('marketplaceFilterFit')}
              </span>
              <Select value={fitFilter} onValueChange={value => setFitFilter(value as NonNullable<MarketplaceSearchParams['fit']>)}>
                <SelectTrigger size="default" aria-label={i18nService.t('marketplaceFilterFit')} className="min-w-32 border-border-subtle bg-surface">
                  <SelectValue className="font-medium text-foreground">{fitFilterLabel}</SelectValue>
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
        <div className="inline-flex min-w-0 max-w-full items-center gap-2 self-center text-sm text-muted-foreground">
          <Monitor className="size-4 shrink-0" aria-hidden="true" />
          {hardwareSummaryReady ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-2">
              <span className="min-w-0 truncate">
                {i18nService.t('marketplaceHardwareGpuLabel')} {hardwareGpuValue}
              </span>
              <Separator orientation="vertical" className="h-4 w-px" aria-hidden="true" />
              <span className="shrink-0 whitespace-nowrap">
                {i18nService.t('marketplaceHardwareMemoryLabel')} {hardwareMemoryValue}
              </span>
            </span>
          ) : (
            <span>{i18nService.t('marketplaceHardwareDetecting')}</span>
          )}
        </div>
      </div>

      {marketplaceError && models.length > 0 ? (
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
        <div ref={marketplaceGridViewportRef} className="@container/marketplace relative min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden scrollbar-gutter-stable">
          <MarketplaceGridSkeleton pageSize={MARKETPLACE_PAGE_SIZE} />
        </div>
      ) : !hasSearched ? null : visibleModels.length === 0 ? (
        <EmptyState
          className="flex-1"
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
      ) : (
        <div ref={marketplaceGridViewportRef} className="@container/marketplace relative min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden scrollbar-gutter-stable">
          <div
            className={marketplaceGridClassName}
          >
            {visibleModels.map(model => {
              return (
                <MarketplaceModelCard
                  key={model.repoId || model.id}
                  model={model}
                  loading={loading}
                  isDownloadActive={model.repoId === activeDownloadModelId}
                  onInstall={onInstall}
                  onOpenDownload={onOpenDownloadPanel}
                />
              );
            })}
          </div>
        </div>
      )}

      {hasSearched && visibleModels.length > 0 ? (
        <ListPagination
          page={currentPage}
          totalPages={pageCount}
          hasNext={hasNextPage}
          disabled={marketplaceLoading}
          onPageChange={handlePageChange}
          className="mt-auto shrink-0 py-1"
        />
      ) : null}
    </div>
  );
}

// In-place loading placeholder that mirrors the model card grid, so the first
// paint of a search never flashes a centered spinner (DESIGN.md: skeletons,
// not full-screen spinners).
function MarketplaceGridSkeleton({ pageSize }: { pageSize: number }) {
  return (
    <div
      aria-hidden="true"
      className={marketplaceGridClassName}
    >
      {Array.from({ length: pageSize }, (_, index) => (
        <MarketplaceModelCardSkeleton key={index} />
      ))}
    </div>
  );
}
