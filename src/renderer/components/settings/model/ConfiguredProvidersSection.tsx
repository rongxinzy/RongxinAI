import { ProviderAvatar } from '@shared/components/model-picker/ProviderAvatar';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { Pencil, Plus, RotateCw, Trash2 } from 'lucide-react';
import type { MagpieProviderSummary } from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';
import type {
  ClassifiedProviderError,
  ProviderErrorAction,
} from '../../../services/modelSettings/providerErrorClassifier';
import { ProviderErrorBanner } from './ProviderErrorBanner';

export interface ConfiguredProvidersSectionProps {
  personalProviders: MagpieProviderSummary[];
  orgConnected: boolean;
  providerErrors: Record<string, ClassifiedProviderError>;
  testingProviderId: string | null;
  showLocalModelsEntry: boolean;
  subscriptionAccountsEnabled: boolean;
  subsBusy: boolean;
  subsRestartBanner: boolean;
  onAddProvider: () => void;
  onTestProvider: (provider: MagpieProviderSummary) => void;
  onEditProvider: (provider: MagpieProviderSummary) => void;
  onDeleteProvider: (provider: MagpieProviderSummary) => void;
  onToggleProviderEnabled: (provider: MagpieProviderSummary, enabled: boolean) => void;
  onRowErrorAction: (
    provider: MagpieProviderSummary,
    action: ProviderErrorAction,
    suggestedUrl?: string,
  ) => void;
  onOpenLocalModels?: () => void;
  onToggleSubscriptions: (enabled: boolean) => void;
  onDismissRestartBanner: () => void;
  onRelaunchApp: () => void;
  onOpenOrgDialog: () => void;
}

export function ConfiguredProvidersSection({
  personalProviders,
  orgConnected,
  providerErrors,
  testingProviderId,
  showLocalModelsEntry,
  subscriptionAccountsEnabled,
  subsBusy,
  subsRestartBanner,
  onAddProvider,
  onTestProvider,
  onEditProvider,
  onDeleteProvider,
  onToggleProviderEnabled,
  onRowErrorAction,
  onOpenLocalModels,
  onToggleSubscriptions,
  onDismissRestartBanner,
  onRelaunchApp,
  onOpenOrgDialog,
}: ConfiguredProvidersSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-medium text-foreground">
            {i18nService.t('modelsProvidersSectionTitle')}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {i18nService.t('modelsProvidersSectionDesc')}
          </p>
        </div>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={onAddProvider}
        >
          <Plus className="size-4" />
          <span>{i18nService.t('magpieAddProvider')}</span>
        </Button>
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {personalProviders.map(provider => {
          const err = providerErrors[provider.id];
          const paused = orgConnected && !provider.off;
          return (
            <div key={provider.id} className="space-y-3 px-4 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onEditProvider(provider)}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <ProviderAvatar
                    name={provider.name}
                    providerKey={provider.id}
                    baseUrl={provider.baseUrl}
                    size="md"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {provider.name}
                      </span>
                      {paused && (
                        <Badge variant="outline">{i18nService.t('modelsOrgPausedHint')}</Badge>
                      )}
                      {provider.off && (
                        <Badge variant="secondary">{i18nService.t('magpieProviderDisabled')}</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {provider.models.length} {i18nService.t('availableModels')}
                    </div>
                  </div>
                </button>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    disabled={testingProviderId === provider.id}
                    onClick={() => onTestProvider(provider)}
                  >
                    <RotateCw className="size-3.5" />
                    <span>{i18nService.t('modelsProvidersTestAction')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    onClick={() => onEditProvider(provider)}
                  >
                    <Pencil className="size-3.5" />
                    <span>{i18nService.t('modelsProvidersEditAction')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={i18nService.t('magpieDeleteProviderTitle')}
                    onClick={() => onDeleteProvider(provider)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <Switch
                    checked={!provider.off}
                    aria-label={provider.name}
                    onCheckedChange={checked => onToggleProviderEnabled(provider, checked)}
                  />
                </div>
              </div>

              {err && (
                <ProviderErrorBanner
                  classified={err}
                  onAction={(action, url) => onRowErrorAction(provider, action, url)}
                />
              )}
            </div>
          );
        })}

        {showLocalModelsEntry && onOpenLocalModels && (
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <ProviderAvatar providerKey="llamacpp" size="md" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {i18nService.t('modelsLocalRowTitle')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {i18nService.t('modelsLocalRowDesc')}
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={onOpenLocalModels}
            >
              {i18nService.t('modelsZeroLocalAction')}
            </Button>
          </div>
        )}

        <div className="space-y-2.5 px-4 py-3.5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <ProviderAvatar providerKey="subscription" size="md" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {i18nService.t('modelsSubsRowTitle')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {i18nService.t('modelsSubsRowDesc')}
                </div>
              </div>
            </div>
            <Switch
              checked={subscriptionAccountsEnabled}
              disabled={subsBusy}
              aria-label={i18nService.t('modelsSubsRowTitle')}
              onCheckedChange={onToggleSubscriptions}
            />
          </div>
          {subsRestartBanner && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <span>{i18nService.t('modelsProvidersRestartRequired')}</span>
              <div className="flex gap-1.5">
                <Button type="button" variant="ghost" size="xs" onClick={onDismissRestartBanner}>
                  {i18nService.t('modelsProvidersRestartLater')}
                </Button>
                <Button type="button" variant="default" size="xs" onClick={onRelaunchApp}>
                  {i18nService.t('modelsProvidersRestartNow')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {!orgConnected && (
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <ProviderAvatar providerKey="organization" size="md" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {i18nService.t('modelsZeroOrgTitle')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {i18nService.t('modelsZeroOrgDesc')}
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={onOpenOrgDialog}
            >
              {i18nService.t('modelsZeroOrgAction')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
