import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@shared/components/ui/input-group';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  localInferenceMutedTextClass,
  MARKETPLACE_PAGE_SIZE,
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
  const pageSize = MARKETPLACE_PAGE_SIZE;
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
      ? Math.ceil(totalCount / pageSize)
      : nextPageNumber
        ? nextPageNumber
        : Math.ceil(installableModels.length / pageSize),
  );
  const currentPage = Math.min(page, pageCount);
  const visibleModels = installableModels;

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
    unsupported: i18nService.t('marketplaceFitUnsupported'),
  }[fitFilter];
  const resultTitle = resultContext === 'search'
    ? `${i18nService.t('marketplaceResultSearch')}${taskFilter !== 'all' ? ` · ${taskLabel ?? taskFilter}` : ''}`
    : resultContext === 'category'
      ? `${i18nService.t('marketplaceResultCategory')} · ${taskLabel ?? taskFilter}`
      : i18nService.t(resultContext === 'recommended' ? 'marketplaceResultRecommended' : 'marketplaceResultAll');
  const resultCount = totalCount ?? installableModels.length;
  const searchParamsForPage = useCallback(
    (pageNumber?: number, queryValue = submittedQuery): MarketplaceSearchParams => ({
      query: queryValue,
      pageNumber,
      task: taskFilter,
      fit: fitFilter,
      featuredOnly: !queryValue.trim() && taskFilter === 'all' && browseMode === 'recommended',
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
    appliedFilterSignatureRef.current = 'recommended:all:all';
    onQueryChange('');
    setSubmittedQuery('');
    setTaskFilter('all');
    setFitFilter('all');
    setBrowseMode('recommended');
    pageRef.current = 1;
    setPage(1);
    setResultContext('recommended');
    onSearch({ query: '', pageNumber: 1, task: 'all', fit: 'all', featuredOnly: true });
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
    <div
      className="flex flex-col gap-4"
    >
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
                className={hasSearched ? 'h-9 min-w-0 flex-1' : 'h-16 flex-1 rounded-3xl'}
              >
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={event => onQueryChange(event.target.value)}
                  placeholder={i18nService.t('marketplaceSearchPlaceholder')}
                  className={hasSearched ? 'text-xs' : 'h-16 text-lg'}
                />
              </InputGroup>
              <Button
                type="submit"
                disabled={marketplaceLoading}
                className={`${localInferenceCompactButtonClass} self-center`}
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
            {hasSearched ? (
              <span className="text-xs text-muted-foreground">
                {i18nService.t('marketplaceResultCount').replace('{count}', String(resultCount))}
              </span>
            ) : null}
          </div>
          {!hasQuery ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {i18nService.t('marketplaceBrowse')}
              </span>
              <FluidTabs
                aria-label={i18nService.t('marketplaceBrowse')}
                value={browseMode}
                onValueChange={value => setBrowseMode(value as MarketplaceBrowseMode)}
                items={[
                  { value: 'recommended', label: i18nService.t('marketplaceBrowseRecommended') },
                  { value: 'all', label: i18nService.t('marketplaceBrowseAll') },
                ]}
              />
            </div>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/40 pt-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {i18nService.t('marketplaceFilterTask')}
              </span>
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
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {i18nService.t('marketplaceFilterFit')}
              </span>
              <Select value={fitFilter} onValueChange={value => setFitFilter(value as NonNullable<MarketplaceSearchParams['fit']>)}>
                <SelectTrigger size="sm" className="min-w-32 rounded-full border-border/60 bg-background/70 px-3">
                  <SelectValue>{fitFilterLabel}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">{i18nService.t('marketplaceFilterFitAll')}</SelectItem>
                    <SelectItem value="recommended">{i18nService.t('marketplaceFitExcellent')}</SelectItem>
                    <SelectItem value="compatible">{i18nService.t('marketplaceFitCompatible')}</SelectItem>
                    <SelectItem value="unsupported">{i18nService.t('marketplaceFitUnsupported')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
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
        <div
          className={`flex min-h-[620px] items-center justify-center text-sm ${localInferenceMutedTextClass}`}
        >
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          {i18nService.t('loading')}
        </div>
      ) : !hasSearched ? null : installableModels.length === 0 ? (
        <div className="flex min-h-[620px] flex-col gap-4">
          {installedModelActions ?? (
            <EmptyState
              title={i18nService.t('marketplaceNoModels')}
              action={
                <Button type="button" size="sm" variant="outline" onClick={handleResetFilters}>
                  {i18nService.t('marketplaceFilterClear')}
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          {installedModelActions}
          <div
            className="mx-auto grid w-full max-w-6xl auto-rows-min content-start gap-4 sm:grid-cols-2 xl:grid-cols-3"
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
            <div className="sticky bottom-0 z-20 mt-6 flex items-center justify-center gap-5 border-t border-border/40 bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80"
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
