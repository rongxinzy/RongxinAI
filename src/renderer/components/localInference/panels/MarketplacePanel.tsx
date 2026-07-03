import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  EyeIcon,
  EyeSlashIcon,
  StopIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useEffect, useMemo, useState } from 'react';

import type { MarketplaceModel } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';
import { EmptyState, InstallProgressBar } from '../components/Common';
import { smallOutlineButtonClass } from '../constants';
import type { InstallProgressState } from '../types';
import {
  capabilityLabel,
  formatDownloadCount,
  getInstallableMarketplaceModels,
  openExternalUrl,
} from '../utils/marketplace';
import { getMarketplacePageSize } from '../utils/marketplace';
import { formatPullProgress, isPullInProgress } from '../utils/progress';

export function MarketplacePanel({
  loading,
  models,
  hasSearched,
  marketplaceLoading,
  marketplaceError,
  marketplaceTotalCount,
  query,
  installedModelPathMap,
  installProgress,
  onQueryChange,
  onSearch,
  onInstall,
}: {
  loading: boolean;
  models: MarketplaceModel[];
  hasSearched: boolean;
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  marketplaceTotalCount: number | null;
  query: string;
  installedModelPathMap: Map<string, string>;
  installProgress: InstallProgressState;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  onInstall: (model: MarketplaceModel) => Promise<void>;
}) {
  const [installingModelIds, setInstallingModelIds] = useState<Set<string>>(new Set());
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenInputVisible, setTokenInputVisible] = useState(false);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [tokenLoaded, setTokenLoaded] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    window.electron.marketplace
      .getToken()
      .then(t => {
        setSavedToken(t);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tokenModalOpen && !tokenLoaded) {
      window.electron.marketplace
        .getToken()
        .then(t => {
          setSavedToken(t);
          setTokenInput(t ?? '');
          setTokenLoaded(true);
        })
        .catch(() => setTokenLoaded(true));
    }
    if (!tokenModalOpen) {
      setTokenLoaded(false);
      setTokenInputVisible(false);
    }
  }, [tokenLoaded, tokenModalOpen]);

  const installableModels = useMemo(
    () => getInstallableMarketplaceModels(models, installedModelPathMap),
    [installedModelPathMap, models],
  );
  const pageSize = getMarketplacePageSize();
  const pageCount = Math.max(1, Math.ceil(installableModels.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleModels = useMemo(
    () => installableModels.slice(pageStart, pageStart + pageSize),
    [installableModels, pageStart, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const handleSaveToken = async () => {
    const trimmed = tokenInput.trim();
    await window.electron.marketplace.setToken(trimmed);
    setSavedToken(trimmed || null);
    setTokenModalOpen(false);
  };

  const handleClearToken = async () => {
    setTokenInput('');
    await window.electron.marketplace.setToken('');
    setSavedToken(null);
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

  const handleNextPage = async () => {
    setPage(value => Math.min(pageCount, value + 1));
  };

  return (
    <div className="space-y-4">
      <div
        className={
          hasSearched
            ? 'flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'
            : 'flex min-h-[420px] flex-col items-center justify-center gap-8'
        }
      >
        <div className={hasSearched ? 'space-y-3' : 'w-full max-w-3xl space-y-3 text-center'}>
          <div>
            <div className="flex items-center gap-3">
              <h2
                className={
                  hasSearched ? 'text-base font-semibold text-foreground' : 'text-2xl font-semibold text-foreground'
                }
              >
                {i18nService.t('marketplaceTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setTokenModalOpen(true)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  savedToken
                    ? 'border border-green-400/30 bg-green-500/10 text-green-600 hover:bg-green-500/20 dark:text-green-400'
                    : 'border border-border bg-surface text-secondary hover:border-primary/40 hover:text-foreground'
                }`}
                title={
                  savedToken
                    ? i18nService.t('marketplaceTokenConfigured')
                    : i18nService.t('marketplaceTokenNotConfigured')
                }
              >
                <AdjustmentsHorizontalIcon className="h-3.5 w-3.5" />
                {savedToken
                  ? i18nService.t('marketplaceTokenConfigured')
                  : i18nService.t('marketplaceTokenSettings')}
              </button>
            </div>
            {hasSearched && (
              <p className="mt-1 text-xs text-secondary">{i18nService.t('marketplaceDescription')}</p>
            )}
          </div>
        </div>
        <form
          className={`w-full ${hasSearched ? 'lg:max-w-xl' : 'max-w-4xl'}`}
          onSubmit={event => {
            event.preventDefault();
            onSearch();
          }}
        >
          <div className={hasSearched ? 'rounded-lg border border-border bg-surface p-3' : 'bg-transparent p-0'}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon
                  className={`${
                    hasSearched ? 'left-2.5 h-3.5 w-3.5' : 'left-4 h-5 w-5'
                  } pointer-events-none absolute top-1/2 -translate-y-1/2 text-secondary`}
                />
                <input
                  value={query}
                  onChange={event => onQueryChange(event.target.value)}
                  placeholder={i18nService.t('marketplaceSearchPlaceholder')}
                  className={`${
                    hasSearched ? 'h-9 rounded-md pl-8 pr-2 text-xs' : 'h-16 rounded-2xl pl-12 pr-4 text-lg'
                  } w-full border border-border bg-surface-input text-foreground placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-primary`}
                />
              </div>
              <button
                type="submit"
                disabled={marketplaceLoading}
                className={`${
                  hasSearched ? 'h-9 rounded-md px-3 text-xs' : 'h-16 rounded-2xl px-8 text-lg'
                } inline-flex items-center gap-1 bg-primary font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {marketplaceLoading && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />}
                {i18nService.t('marketplaceSearch')}
              </button>
            </div>
          </div>
        </form>
      </div>

      {(() => {
        const isAuthError = marketplaceError?.startsWith('AUTH_ERROR:');
        const statusClass = isAuthError
          ? 'border-yellow-400/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
          : marketplaceError
            ? 'border-yellow-400/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
            : savedToken
              ? 'border-green-400/40 bg-green-500/10 text-green-600 dark:text-green-400'
              : 'border-border bg-surface text-secondary';
        const statusText = isAuthError
          ? i18nService.t('marketplaceSearchStatusTokenInvalid')
          : marketplaceError
            ? i18nService.t('marketplaceSearchStatusLegacy')
            : savedToken
              ? i18nService.t('marketplaceSearchStatusOpenApi')
              : i18nService.t('marketplaceSearchStatusWarning');
        const count =
          marketplaceTotalCount == null
            ? installableModels.length
            : Math.min(marketplaceTotalCount, installableModels.length);
        return (
          !marketplaceLoading &&
          installableModels.length > 0 && (
            <div className={`rounded-md border px-3 py-1.5 text-xs ${statusClass}`}>
              <span className="font-medium">{statusText}</span>
              <span className="ml-3 opacity-70">
                {i18nService.t('marketplaceResultCount').replace('{count}', String(count))}
              </span>
            </div>
          )
        );
      })()}

      {marketplaceError && models.length === 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
          {i18nService.t('marketplaceError')}: {marketplaceError}
        </div>
      )}

      {marketplaceLoading ? (
        <div className="flex min-h-[620px] items-center justify-center text-sm text-secondary">
          <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
          {i18nService.t('loading')}
        </div>
      ) : !hasSearched ? null : installableModels.length === 0 ? (
        <EmptyState title={i18nService.t('marketplaceNoModels')} className="min-h-[620px]" />
      ) : (
        <div className="flex min-h-[620px] flex-col">
          <div className="grid content-start gap-3 md:grid-cols-2">
            {visibleModels.map(model => {
              const progress = installProgress[model.repoId];
              const installing = installingModelIds.has(model.id) || isPullInProgress(progress);
              return (
                <div
                  key={model.id}
                  className="flex h-[168px] min-w-0 flex-col justify-between overflow-hidden rounded-lg border border-border bg-card p-3 transition-colors hover:bg-surface-raised"
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="max-h-10 min-w-0 overflow-hidden break-all text-sm font-semibold leading-5 text-foreground">
                        {model.repoId}
                      </h3>
                      <span className="inline-flex h-5 items-center rounded-md bg-surface-raised px-1.5 text-[11px] font-medium text-secondary">
                        {model.recommendedTag}
                      </span>
                      <span className="inline-flex h-5 items-center rounded-md border border-border px-1.5 text-[11px] font-medium text-secondary">
                        {capabilityLabel(model.capability)}
                      </span>
                    </div>
                    <p className="mt-1.5 max-h-10 overflow-hidden text-xs leading-5 text-secondary">
                      {model.description}
                    </p>
                    <div className="mt-2 flex max-h-5 flex-wrap gap-1.5 overflow-hidden">
                      {model.sizes.map(size => (
                        <span
                          key={size}
                          className="inline-flex h-5 items-center rounded-md border border-border px-1.5 text-[11px] font-mono text-secondary"
                        >
                          {size}
                        </span>
                      ))}
                      {model.tags.slice(0, 3).map(tag => (
                        <span
                          key={tag}
                          className="inline-flex h-5 items-center rounded-md bg-surface-raised px-1.5 text-[11px] text-secondary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {progress && (
                      <div className="mt-2 rounded-md bg-surface-raised px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-secondary">
                          <span>{formatPullProgress(progress)}</span>
                          {typeof progress.percent === 'number' && <span>{progress.percent}%</span>}
                        </div>
                        <InstallProgressBar progress={progress} className="mt-2" />
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-secondary">{formatDownloadCount(model.downloads)}</span>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {model.detailUrl && (
                        <button
                          type="button"
                          onClick={() => void openExternalUrl(model.detailUrl!)}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground/80 transition-colors hover:bg-surface-raised"
                        >
                          <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                          {i18nService.t('marketplaceOpenModelScope')}
                        </button>
                      )}
                      {installing ? (
                        <button
                          type="button"
                          onClick={() => void window.electron.llamacpp.cancelInstall(model.repoId)}
                          className={smallOutlineButtonClass}
                        >
                          <StopIcon className="h-3.5 w-3.5" />
                          {i18nService.t('marketplaceCancelInstall')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleInstall(model)}
                          disabled={installing || loading}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
                        >
                          <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                          {i18nService.t('marketplaceInstall')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {pageCount > 1 && (
            <div className="mx-auto mt-auto flex items-center justify-center gap-3 pt-4">
              <button
                type="button"
                onClick={() => setPage(value => Math.max(1, value - 1))}
                disabled={currentPage <= 1}
                className="inline-flex h-8 min-w-20 items-center justify-center rounded-md border border-border px-3 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {i18nService.t('skillMarketplacePrevPage')}
              </button>
              <span className="inline-flex h-8 min-w-16 items-center justify-center text-sm text-secondary">
                {currentPage}/{pageCount} {i18nService.t('marketplacePageUnit')}
              </span>
              <button
                type="button"
                onClick={() => void handleNextPage()}
                disabled={currentPage >= pageCount}
                className="inline-flex h-8 min-w-20 items-center justify-center rounded-md border border-border px-3 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {i18nService.t('skillMarketplaceNextPage')}
              </button>
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
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground">
              {i18nService.t('marketplaceTokenSettingsTitle')}
            </h3>
            <button
              type="button"
              onClick={() => setTokenModalOpen(false)}
              className="rounded-md p-1 text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="text-sm leading-relaxed text-secondary">
            {i18nService.t('marketplaceTokenSettingsDesc')}
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wide text-secondary">
              ModelScope API Token
            </label>
            <div className="relative">
              <input
                type={tokenInputVisible ? 'text' : 'password'}
                value={tokenInput}
                onChange={event => setTokenInput(event.target.value)}
                placeholder={i18nService.t('marketplaceTokenPlaceholder')}
                className="w-full rounded-xl border border-border bg-surface-inset px-3 py-2 pr-16 text-sm text-foreground placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="absolute inset-y-0 right-2 flex items-center gap-1">
                {tokenInput && (
                  <button
                    type="button"
                    onClick={() => setTokenInput('')}
                    className="rounded p-0.5 text-secondary transition-colors hover:text-primary"
                    title={i18nService.t('marketplaceTokenClear')}
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTokenInputVisible(v => !v)}
                  className="rounded p-0.5 text-secondary transition-colors hover:text-primary"
                >
                  {tokenInputVisible ? (
                    <EyeSlashIcon className="h-4 w-4" />
                  ) : (
                    <EyeIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handleClearToken}
              disabled={!savedToken}
              className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-secondary transition-colors hover:border-red-400/40 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {i18nService.t('marketplaceTokenClear')}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTokenModalOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveToken()}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
              >
                {i18nService.t('marketplaceTokenSave')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}
