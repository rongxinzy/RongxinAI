import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@shared/components/ui/input-group';
import { Label } from '@shared/components/ui/label';
import { Eye, EyeOff, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { MarketplaceModel } from '../../../../shared/marketplace';
import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';
import { EmptyState } from '../components/Common';
import { MarketplaceModelCard } from '../components/MarketplaceModelCard';
import { localInferenceMutedTextClass } from '../constants';
import type { InstallProgressState } from '../types';
import { getInstallableMarketplaceModels, getMarketplacePageSize } from '../utils/marketplace';
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
  onQueryChange,
  onSearch,
  onBrowseAll,
  onInstall,
}: {
  loading: boolean;
  models: MarketplaceModel[];
  hasSearched: boolean;
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  query: string;
  installedModelPathMap: Map<string, string>;
  installProgress: InstallProgressState;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  onBrowseAll: () => void;
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
    <div className="space-y-4">
      <div
        className={
          hasSearched
            ? 'grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(28rem,40rem)_minmax(0,1fr)] lg:items-center'
            : 'flex min-h-[420px] flex-col items-center justify-center gap-8'
        }
      >
        {!hasSearched ? (
          <div className="w-full max-w-3xl space-y-3 text-center">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold text-foreground">
                {i18nService.t('marketplaceTitle')}
              </h2>
              {tokenSettingsButton}
            </div>
          </div>
        ) : null}
        <form
          className={`w-full ${hasSearched ? 'lg:col-start-2' : 'max-w-4xl'}`}
          onSubmit={event => {
            event.preventDefault();
            onSearch();
          }}
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
        </form>
        {hasSearched ? (
          <div className="flex justify-start gap-2 lg:col-start-3 lg:justify-end">
            <Button type="button" onClick={onBrowseAll} size="xs" variant="outline">
              {i18nService.t('marketplaceBrowseAll')}
            </Button>
            {tokenSettingsButton}
          </div>
        ) : null}
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
        <div className="flex flex-col">
          <div className="grid auto-rows-min content-start gap-3 md:grid-cols-2">
            {visibleModels.map(model => {
              const progress = installProgress[model.repoId] ?? installProgress[model.id];
              const installing = installingModelIds.has(model.id) || isPullInProgress(progress);
              return (
                <MarketplaceModelCard
                  key={model.id}
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
            <div className="mx-auto mt-6 flex items-center justify-center gap-3">
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
