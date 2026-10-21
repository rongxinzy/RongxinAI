import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { Lock, Plus, Power, RefreshCw, Settings, Trash2 } from 'lucide-react';
import React, { useState } from 'react';

import type {
  MagpieProviderSummary,
  MagpieSaveProviderInput,
  MagpieTestProviderResult,
} from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';
import { ProviderEditDialog } from './ProviderEditDialog';

interface ProviderManagerSectionProps {
  providers: MagpieProviderSummary[];
  loading?: boolean;
  disabled?: boolean;
  onRefresh: () => Promise<void>;
  onSaveProvider: (input: MagpieSaveProviderInput) => Promise<boolean>;
  onToggleProvider: (id: string, enabled: boolean) => Promise<boolean>;
  onDeleteProvider: (id: string) => Promise<boolean>;
  onTestProvider?: (input: MagpieSaveProviderInput) => Promise<MagpieTestProviderResult>;
}

export const ProviderManagerSection: React.FC<ProviderManagerSectionProps> = ({
  providers,
  loading = false,
  disabled = false,
  onRefresh,
  onSaveProvider,
  onToggleProvider,
  onDeleteProvider,
  onTestProvider,
}) => {
  const [editingProvider, setEditingProvider] = useState<MagpieProviderSummary | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleOpenAdd = () => {
    setEditingProvider(null);
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (provider: MagpieProviderSummary) => {
    setEditingProvider(provider);
    setIsDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    setIsDeleting(true);
    try {
      await onDeleteProvider(deletingId);
      setDeletingId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{i18nService.t('magpieProvidersTitle')}</h2>
          <p className="text-sm text-muted-foreground">
            {i18nService.t('magpieProvidersDescription')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void onRefresh()}
            disabled={disabled || loading}
            aria-label={i18nService.t('magpieRefreshProviders')}
            title={i18nService.t('magpieRefreshProviders')}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleOpenAdd}
            disabled={disabled || loading}
            className="gap-1.5"
          >
            <Plus className="size-4" />
            <span>{i18nService.t('magpieAddProvider')}</span>
          </Button>
        </div>
      </div>

      {!providers.length && !loading && (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {i18nService.t('magpieNoProviders')}
        </div>
      )}

      {providers.length > 0 && (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {providers.map(provider => {
            const isHost = provider.isHostManaged === true;
            const isActive = !provider.off;

            return (
              <div
                key={provider.id}
                className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                  isActive ? '' : 'opacity-60'
                }`}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{provider.name}</span>
                    <Badge variant="outline" className="font-normal">
                      {provider.api}
                    </Badge>
                    {isHost ? (
                      <Badge variant="secondary" className="gap-1">
                        <Lock className="size-3" />
                        <span>{i18nService.t('magpieHostManaged')}</span>
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1.5">
                        {isActive ? (
                          <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                        ) : null}
                        {i18nService.t(
                          isActive ? 'magpieProviderEnabled' : 'magpieProviderDisabled',
                        )}
                      </Badge>
                    )}
                  </div>

                  <p className="truncate text-sm text-muted-foreground">
                    {provider.baseUrl || i18nService.t('magpieLoopbackGateway')}
                  </p>

                  {provider.models.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {provider.models.slice(0, 4).map(m => (
                        <span
                          key={m}
                          className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {m}
                        </span>
                      ))}
                      {provider.models.length > 4 && (
                        <span className="text-xs text-muted-foreground">
                          {i18nService
                            .t('magpieProviderMoreModels')
                            .replace('{count}', String(provider.models.length - 4))}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1 self-end sm:self-center">
                  {!isHost && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void onToggleProvider(provider.id, provider.off)}
                        disabled={disabled || loading}
                        aria-label={i18nService.t(
                          isActive ? 'magpieDisableProvider' : 'magpieEnableProvider',
                        )}
                        title={i18nService.t(
                          isActive ? 'magpieDisableProvider' : 'magpieEnableProvider',
                        )}
                      >
                        <Power
                          className={`size-4 ${
                            isActive ? 'text-foreground' : 'text-muted-foreground'
                          }`}
                        />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(provider)}
                        disabled={disabled || loading}
                        aria-label={i18nService.t('magpieEditProvider')}
                        title={i18nService.t('magpieEditProvider')}
                      >
                        <Settings className="size-4 text-muted-foreground" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeletingId(provider.id)}
                        disabled={disabled || loading}
                        aria-label={i18nService.t('magpieDeleteProviderTitle')}
                        title={i18nService.t('magpieDeleteProviderTitle')}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ProviderEditDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        provider={editingProvider}
        onSave={onSaveProvider}
        onTest={onTestProvider}
      />

      <DestructiveConfirmDialog
        open={Boolean(deletingId)}
        title={i18nService.t('magpieDeleteProviderTitle')}
        description={i18nService.t('magpieDeleteProviderDescription')}
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={i18nService.t('delete')}
        isConfirming={isDeleting}
        onCancel={() => setDeletingId(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
};
