import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@shared/components/ui/input-group';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';

import type { MarketplaceModel } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';
import { EmptyState } from '../components/Common';
import { MarketplaceModelCard } from '../components/MarketplaceModelCard';
import {
  localInferenceCompactButtonClass,
  localInferenceMutedTextClass,
  MARKETPLACE_PAGE_SIZE,
} from '../constants';
import type { InstallProgressState } from '../types';
import {
  getInstallableMarketplaceModels,
  getMarketplaceGridColumnCount,
  getMarketplaceInstallProgress,
  getMarketplacePageSize,
} from '../utils/marketplace';
import { isPullInProgress } from '../utils/progress';

export function MarketplacePanel({
  loading,
  models,
  hasSearched,
  marketplaceLoading,
  marketplaceError,
  query,
  installedModelPathMap,
  installProgress,
  savedToken,
  onTokenSaved,
  onQueryChange,
  onSearch,
  onInstall,
  contentViewportRef,
}: {
  loading: boolean;
  models: MarketplaceModel[];
  hasSearched: boolean;
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  query: string;
  installedModelPathMap: Map<string, string>;
  installProgress: InstallProgressState;
  savedToken: string | null;
  onTokenSaved: (token: string | null) => void;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  onInstall: (model: MarketplaceModel) => Promise<void>;
  contentViewportRef: RefObject<HTMLDivElement | null>;
}) {
  const [installingModelIds, setInstallingModelIds] = useState<Set<string>>(new Set());
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenInputVisible, setTokenInputVisible] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(MARKETPLACE_PAGE_SIZE);
  const [panelMinHeight, setPanelMinHeight] = useState<number | null>(null);
  const pageRef = useRef(page);
  const pageSizeRef = useRef(pageSize);
  const resizeFrameRef = useRef<number | null>(null);
  const layoutSignatureRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const paginationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    if (tokenModalOpen) setTokenInput(savedToken ?? '');
    else setTokenInputVisible(false);
  }, [savedToken, tokenModalOpen]);

  const installableModels = useMemo(
    () => getInstallableMarketplaceModels(models, installedModelPathMap),
    [installedModelPathMap, models],
  );
  const pageCount = Math.max(1, Math.ceil(installableModels.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleModels = useMemo(
    () => installableModels.slice(pageStart, pageStart + pageSize),
    [installableModels, pageStart, pageSize],
  );

  useLayoutEffect(() => {
    const contentViewport = contentViewportRef.current;
    const panel = panelRef.current;
    const grid = gridRef.current;
    if (!contentViewport || !panel || !grid || visibleModels.length === 0) return;

    layoutSignatureRef.current = null;

    const updatePageSize = () => {
      const gridStyle = window.getComputedStyle(grid);
      const viewportRect = contentViewport.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const pagination = paginationRef.current;
      const paginationHeight = pagination ? pagination.getBoundingClientRect().height : 0;
      const content = contentViewport.firstElementChild as HTMLElement | null;
      const contentPaddingBottom = content
        ? Number.parseFloat(window.getComputedStyle(content).paddingBottom) || 0
        : 0;
      const cards = Array.from(grid.children) as HTMLElement[];
      const cardRects = cards.map(card => card.getBoundingClientRect());
      const cardHeight = Math.max(...cardRects.map(rect => rect.height));
      const cardWidth = Math.max(...cardRects.map(rect => rect.width));
      const rowGap = Number.parseFloat(gridStyle.rowGap) || 0;
      const columnGap = Number.parseFloat(gridStyle.columnGap) || 0;
      const columnCount = getMarketplaceGridColumnCount({
        gridWidth: grid.clientWidth,
        cardWidth,
        columnGap,
      });
      const gridTop = gridRect.top - viewportRect.top;
      const panelTop = panel.getBoundingClientRect().top - viewportRect.top;
      const nextPanelMinHeight = Math.max(
        0,
        Math.floor(contentViewport.clientHeight - panelTop - contentPaddingBottom),
      );
      setPanelMinHeight(value => (value === nextPanelMinHeight ? value : nextPanelMinHeight));
      const layoutSignature = [
        contentViewport.clientWidth,
        contentViewport.clientHeight,
        columnCount,
        gridTop,
        paginationHeight,
        contentPaddingBottom,
        cardHeight,
        rowGap,
      ].join(':');
      if (layoutSignature === layoutSignatureRef.current) return;

      const availableGridHeight =
        contentViewport.clientHeight - gridTop - paginationHeight - contentPaddingBottom;
      const nextPageSize = getMarketplacePageSize({
        availableGridHeight,
        cardHeight,
        columnCount,
        rowGap,
      });
      layoutSignatureRef.current = layoutSignature;
      const currentPageSize = pageSizeRef.current;
      if (nextPageSize === currentPageSize) return;

      const firstVisibleIndex = (pageRef.current - 1) * currentPageSize;
      const nextPage = Math.floor(firstVisibleIndex / nextPageSize) + 1;
      pageSizeRef.current = nextPageSize;
      pageRef.current = nextPage;
      setPageSize(nextPageSize);
      setPage(nextPage);
    };
    const schedulePageSizeUpdate = () => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = requestAnimationFrame(updatePageSize);
    };

    const resizeObserver = new ResizeObserver(schedulePageSizeUpdate);
    resizeObserver.observe(contentViewport);
    resizeObserver.observe(panel);
    resizeObserver.observe(grid);
    if (paginationRef.current) resizeObserver.observe(paginationRef.current);
    schedulePageSizeUpdate();
    window.addEventListener('resize', schedulePageSizeUpdate);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', schedulePageSizeUpdate);
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    };
  }, [contentViewportRef, hasSearched, marketplaceError, models, pageCount, visibleModels.length]);

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

  const handleSaveToken = async () => {
    const trimmed = tokenInput.trim();
    await window.electron.marketplace.setToken(trimmed);
    onTokenSaved(trimmed || null);
    setTokenModalOpen(false);
  };

  const handleClearToken = async () => {
    setTokenInput('');
    await window.electron.marketplace.setToken('');
    onTokenSaved(null);
    setTokenModalOpen(false);
  };

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

  const handleNextPage = () => {
    setPage(value => {
      const nextPage = Math.min(pageCount, value + 1);
      pageRef.current = nextPage;
      return nextPage;
    });
  };

  const tokenSettingsButton = (
    <Button
      type="button"
      onClick={() => setTokenModalOpen(true)}
      size="xs"
      variant={savedToken ? 'secondary' : 'outline'}
      title={
        savedToken
          ? i18nService.t('marketplaceTokenConfigured')
          : i18nService.t('marketplaceTokenNotConfigured')
      }
    >
      <SlidersHorizontal data-icon="inline-start" />
      {savedToken
        ? i18nService.t('marketplaceTokenConfigured')
        : i18nService.t('marketplaceTokenSettings')}
    </Button>
  );

  return (
    <div
      ref={panelRef}
      className="flex flex-col gap-4"
      style={panelMinHeight === null ? undefined : { minHeight: panelMinHeight }}
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
              <h2 className="text-2xl font-semibold text-foreground">
                {i18nService.t('marketplaceTitle')}
              </h2>
              {tokenSettingsButton}
            </div>
          </div>
        ) : null}
        <div
          className={
            hasSearched ? 'mx-auto flex w-full items-center justify-center gap-3' : 'w-full'
          }
        >
          <form
            className={`min-w-0 ${hasSearched ? 'basis-1/2' : 'mx-auto w-full max-w-4xl'}`}
            onSubmit={event => {
              event.preventDefault();
              onSearch();
            }}
          >
            <div className="flex gap-2">
              <InputGroup
                className={hasSearched ? 'h-9 min-w-0 flex-1' : 'h-16 flex-1 rounded-2xl'}
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
          {hasSearched ? <div className="shrink-0">{tokenSettingsButton}</div> : null}
        </div>
      </div>

      {marketplaceError ? (
        <Alert>
          <AlertTitle>
            {marketplaceError.startsWith('AUTH_ERROR:')
              ? i18nService.t('marketplaceSearchStatusTokenInvalid')
              : i18nService.t('marketplaceSearchStatusWarning')}
          </AlertTitle>
          <AlertDescription>{marketplaceError.replace(/^AUTH_ERROR:\s*/, '')}</AlertDescription>
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
        <EmptyState title={i18nService.t('marketplaceNoModels')} className="min-h-[620px]" />
      ) : (
        <div className="flex flex-1 flex-col">
          <div
            ref={gridRef}
            className="mx-auto grid w-full max-w-5xl auto-rows-min content-start gap-3 md:grid-cols-2"
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
          {pageCount > 1 && (
            <div
              ref={paginationRef}
              className="sticky bottom-0 z-10 mt-auto flex items-center justify-center gap-6 bg-background pb-2 pt-6"
            >
              <Button
                type="button"
                onClick={() => {
                  setPage(value => {
                    const previousPage = Math.max(1, value - 1);
                    pageRef.current = previousPage;
                    return previousPage;
                  });
                }}
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
                onClick={() => void handleNextPage()}
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

      <Modal
        isOpen={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        className="mx-4 w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground">
              {i18nService.t('marketplaceTokenSettingsTitle')}
            </h3>
            <Button
              type="button"
              onClick={() => setTokenModalOpen(false)}
              size="icon-sm"
              variant="ghost"
              aria-label={i18nService.t('close')}
            >
              <X />
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <InputGroup>
              <InputGroupInput
                id="marketplace-token"
                type={tokenInputVisible ? 'text' : 'password'}
                value={tokenInput}
                onChange={event => setTokenInput(event.target.value)}
                placeholder={i18nService.t('marketplaceTokenPlaceholder')}
              />
              <InputGroupAddon align="inline-end">
                {tokenInput && (
                  <InputGroupButton
                    onClick={() => setTokenInput('')}
                    aria-label={i18nService.t('marketplaceTokenClear')}
                    size="icon-xs"
                  >
                    <X />
                  </InputGroupButton>
                )}
                <InputGroupButton
                  onClick={() => setTokenInputVisible(v => !v)}
                  aria-label={i18nService.t(tokenInputVisible ? 'hide' : 'show')}
                  size="icon-xs"
                >
                  {tokenInputVisible ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
          <div className="flex items-center justify-between pt-1">
            <Button
              type="button"
              onClick={handleClearToken}
              disabled={!savedToken}
              className={localInferenceCompactButtonClass}
              size="sm"
              variant="destructive"
            >
              {i18nService.t('marketplaceTokenClear')}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => setTokenModalOpen(false)}
                size="sm"
                variant="outline"
                className={localInferenceCompactButtonClass}
              >
                {i18nService.t('cancel')}
              </Button>
              <Button
                type="button"
                className={localInferenceCompactButtonClass}
                onClick={() => void handleSaveToken()}
                size="sm"
                variant="outline"
              >
                {i18nService.t('marketplaceTokenSave')}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
