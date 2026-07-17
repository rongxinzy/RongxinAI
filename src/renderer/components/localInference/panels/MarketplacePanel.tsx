import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@shared/components/ui/card';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@shared/components/ui/input-group';
import { Label } from '@shared/components/ui/label';
import {
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { MarketplaceModel } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';
import { EmptyState, InstallProgressBar } from '../components/Common';
import { localInferenceMutedTextClass, localInferenceSoftTextClass } from '../constants';
import type { InstallProgressState } from '../types';
import {
  capabilityLabel,
  formatDownloadCount,
  getInstallableMarketplaceModels,
  getMarketplaceInstallProgress,
  getMarketplacePageSize,
  openExternalUrl,
} from '../utils/marketplace';
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
                  hasSearched
                    ? 'text-base font-semibold text-foreground'
                    : 'text-2xl font-semibold text-foreground'
                }
              >
                {i18nService.t('marketplaceTitle')}
              </h2>
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
            </div>
            {hasSearched && (
              <p className={`mt-1 text-xs ${localInferenceMutedTextClass}`}>
                {i18nService.t('marketplaceDescription')}
              </p>
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
          <div
            className={
              hasSearched ? 'rounded-lg border border-border bg-surface p-3' : 'bg-transparent p-0'
            }
          >
            <div className="flex gap-2">
              <InputGroup className={hasSearched ? 'h-9 flex-1' : 'h-16 flex-1 rounded-2xl'}>
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
                className={hasSearched ? 'h-9 text-xs' : 'h-16 rounded-2xl px-8 text-lg'}
              >
                {marketplaceLoading && (
                  <RefreshCw data-icon="inline-start" className="animate-spin" />
                )}
                {i18nService.t('marketplaceSearch')}
              </Button>
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
              : `border-border bg-surface ${localInferenceSoftTextClass}`;
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
        <div
          className={`flex min-h-[620px] items-center justify-center text-sm ${localInferenceMutedTextClass}`}
        >
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          {i18nService.t('loading')}
        </div>
      ) : !hasSearched ? null : installableModels.length === 0 ? (
        <EmptyState title={i18nService.t('marketplaceNoModels')} className="min-h-[620px]" />
      ) : (
        <div className="flex min-h-[620px] flex-col">
          <div className="grid content-start gap-3 md:grid-cols-2">
            {visibleModels.map(model => {
              const progress = getMarketplaceInstallProgress(installProgress, model);
              const installing = installingModelIds.has(model.id) || isPullInProgress(progress);
              return (
                <Card
                  key={model.id}
                  size="sm"
                  className="min-w-0 gap-0 p-0 transition-colors hover:bg-surface-raised"
                >
                  <CardHeader className="gap-2 px-3 pt-3 pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="max-h-10 min-w-0 overflow-hidden break-all text-sm leading-5">
                        {model.repoId}
                      </CardTitle>
                      <Badge variant="secondary">{model.recommendedTag}</Badge>
                      <Badge variant="outline">{capabilityLabel(model.capability)}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2">
                    <p
                      className={`max-h-10 overflow-hidden text-xs leading-5 ${localInferenceMutedTextClass}`}
                    >
                      {model.description}
                    </p>
                    <div className="flex max-h-5 flex-wrap gap-1.5 overflow-hidden">
                      {model.sizes.map(size => (
                        <Badge key={size} variant="outline" className="font-mono">
                          {size}
                        </Badge>
                      ))}
                      {model.tags.slice(0, 3).map(tag => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                  {progress && (
                    <div className="border-t border-border px-3 py-2">
                      <div
                        className={`flex items-center justify-between gap-2 text-[11px] ${localInferenceMutedTextClass}`}
                      >
                        <span className="min-w-0 truncate">{formatPullProgress(progress)}</span>
                        {typeof progress.percent === 'number' && <span>{progress.percent}%</span>}
                      </div>
                      <InstallProgressBar progress={progress} className="mt-1.5" />
                    </div>
                  )}
                  <CardFooter className="justify-between gap-2 p-3">
                    <span className={`text-xs ${localInferenceMutedTextClass}`}>
                      {formatDownloadCount(model.downloads)}
                    </span>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {model.detailUrl && (
                        <Button
                          type="button"
                          onClick={() => void openExternalUrl(model.detailUrl!)}
                          size="sm"
                          variant="outline"
                        >
                          <ExternalLink data-icon="inline-start" />
                          {i18nService.t('marketplaceOpenModelScope')}
                        </Button>
                      )}
                      {installing ? (
                        <Button
                          type="button"
                          onClick={() => void window.electron.llamacpp.cancelInstall(model.repoId)}
                          size="sm"
                          variant="outline"
                        >
                          <Square data-icon="inline-start" />
                          {i18nService.t('marketplaceCancelInstall')}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => void handleInstall(model)}
                          disabled={installing || loading}
                          size="sm"
                        >
                          <Download data-icon="inline-start" />
                          {i18nService.t('marketplaceInstall')}
                        </Button>
                      )}
                    </div>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
          {pageCount > 1 && (
            <div className="mx-auto mt-auto flex items-center justify-center gap-3 pt-4">
              <Button
                type="button"
                onClick={() => setPage(value => Math.max(1, value - 1))}
                disabled={currentPage <= 1}
                variant="outline"
              >
                {i18nService.t('skillMarketplacePrevPage')}
              </Button>
              <span
                className={`inline-flex h-8 min-w-16 items-center justify-center text-sm ${localInferenceMutedTextClass}`}
              >
                {currentPage}/{pageCount} {i18nService.t('marketplacePageUnit')}
              </span>
              <Button
                type="button"
                onClick={() => void handleNextPage()}
                disabled={currentPage >= pageCount}
                variant="outline"
              >
                {i18nService.t('skillMarketplaceNextPage')}
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
          <p className={`text-sm leading-relaxed ${localInferenceMutedTextClass}`}>
            {i18nService.t('marketplaceTokenSettingsDesc')}
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="marketplace-token">
              {i18nService.t('marketplaceTokenSettingsTitle')}
            </Label>
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
              >
                {i18nService.t('cancel')}
              </Button>
              <Button type="button" onClick={() => void handleSaveToken()} size="sm">
                {i18nService.t('marketplaceTokenSave')}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
