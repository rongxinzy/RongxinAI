import { ProviderAvatar } from '@shared/components/model-picker/ProviderAvatar';
import { Button } from '@shared/components/ui/button';
import { ArrowRight, Plus } from 'lucide-react';
import { i18nService } from '../../../services/i18n';
import {
  type ConsolidatedProviderPreset,
  POPULAR_PROVIDER_PRESETS,
} from '../../../services/modelSettings/providerPresets';

export interface ModelsZeroStateProps {
  onSelectPreset: (preset: ConsolidatedProviderPreset) => void;
  onOpenCustomWizard: () => void;
  onOpenLocalModels?: () => void;
  onEnableLocalSubscriptions: () => void;
  onConnectOrganization: () => void;
  enablingSubscriptions?: boolean;
  showLocalModelsOption?: boolean;
}

export function ModelsZeroState({
  onSelectPreset,
  onOpenCustomWizard,
  onOpenLocalModels,
  onEnableLocalSubscriptions,
  onConnectOrganization,
  enablingSubscriptions = false,
  showLocalModelsOption = true,
}: ModelsZeroStateProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 py-6">
      <div className="space-y-2 text-center">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          {i18nService.t('modelsZeroTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{i18nService.t('modelsZeroSubtitle')}</p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {i18nService.t('modelsZeroPopularTitle')}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={onOpenCustomWizard}
          >
            <Plus className="size-3.5" />
            <span>{i18nService.t('providerWizardCustomCardTitle')}</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {POPULAR_PROVIDER_PRESETS.map(preset => (
            <button
              key={preset.key}
              type="button"
              onClick={() => onSelectPreset(preset)}
              className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <ProviderAvatar name={preset.name} providerKey={preset.key} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{preset.name}</div>
                <div className="truncate text-xs text-muted-foreground">{preset.shortDesc}</div>
              </div>
              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {i18nService.t('modelsZeroOtherOptions')}
        </h3>
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {showLocalModelsOption && onOpenLocalModels && (
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <ProviderAvatar providerKey="llamacpp" size="md" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {i18nService.t('modelsZeroLocalTitle')}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {i18nService.t('modelsZeroLocalDesc')}
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

          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <ProviderAvatar providerKey="subscription" size="md" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {i18nService.t('modelsZeroSubsTitle')}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {i18nService.t('modelsZeroSubsDesc')}
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={enablingSubscriptions}
              onClick={onEnableLocalSubscriptions}
            >
              {i18nService.t('modelsZeroSubsAction')}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <ProviderAvatar providerKey="organization" size="md" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {i18nService.t('modelsZeroOrgTitle')}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {i18nService.t('modelsZeroOrgDesc')}
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={onConnectOrganization}
            >
              {i18nService.t('modelsZeroOrgAction')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
