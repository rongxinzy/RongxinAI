import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Card, CardContent } from '@shared/components/ui/card';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { Lock, Plus, Settings, Trash2, Power, RefreshCw } from 'lucide-react';
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
    <div className="space-y-4 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{i18nService.t('magpieProvidersTitle')}</h3>
          <p className="text-xs text-muted-foreground">
            {i18nService.t('magpieProvidersDescription')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void onRefresh()}
            disabled={disabled || loading}
            aria-label={i18nService.t('magpieRefreshProviders')}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpenAdd}
            disabled={disabled || loading}
            className="gap-1.5"
          >
            <Plus className="size-3.5" />
            <span>{i18nService.t('magpieAddProvider')}</span>
          </Button>
        </div>
      </div>

      {!providers.length && !loading && (
        <Card className="border-dashed p-6 text-center text-sm text-muted-foreground">
          {i18nService.t('magpieNoProviders')}
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {providers.map(provider => {
          const isHost = provider.isHostManaged === true;
          const isActive = !provider.off;

          return (
            <Card
              key={provider.id}
              className={`p-3.5 transition-colors ${
                !isActive ? 'opacity-65' : ''
              } border-border bg-card`}
            >
              <CardContent className="flex flex-col gap-2 p-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{provider.name}</span>
                    <Badge variant="outline" className="text-[11px] font-normal">
                      {provider.api}
                    </Badge>
                    {isHost ? (
                      <Badge variant="secondary" className="gap-1 text-[11px]">
                        <Lock className="size-3" />
                        <span>{i18nService.t('magpieHostManaged')}</span>
                      </Badge>
                    ) : (
                      <Badge variant={isActive ? 'default' : 'secondary'} className="text-[11px]">
                        {isActive
                          ? i18nService.t('magpieProviderEnabled')
                          : i18nService.t('magpieProviderDisabled')}
                      </Badge>
                    )}
                  </div>

                  <p className="truncate text-xs text-muted-foreground">
                    {provider.baseUrl || 'Loopback Gateway'}
                  </p>

                  {provider.models.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {provider.models.slice(0, 4).map(m => (
                        <span
                          key={m}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {m}
                        </span>
                      ))}
                      {provider.models.length > 4 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{provider.models.length - 4} more
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 self-end sm:self-center">
                  {!isHost && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => void onToggleProvider(provider.id, provider.off)}
                        disabled={disabled || loading}
                        title={
                          isActive
                            ? i18nService.t('magpieProviderDisabled')
                            : i18nService.t('magpieProviderEnabled')
                        }
                      >
                        <Power
                          className={`size-3.5 ${
                            isActive ? 'text-foreground' : 'text-muted-foreground'
                          }`}
                        />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => handleOpenEdit(provider)}
                        disabled={disabled || loading}
                        title={i18nService.t('magpieEditProvider')}
                      >
                        <Settings className="size-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => setDeletingId(provider.id)}
                        disabled={disabled || loading}
                        title={i18nService.t('magpieDeleteProviderTitle')}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
    </div>
  );
};
