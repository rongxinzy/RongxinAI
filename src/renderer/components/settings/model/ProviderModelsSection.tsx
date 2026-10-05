import { Button } from '@shared/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';
import { PlusCircle, RefreshCw } from 'lucide-react';

import { ProviderName, type DiscoveredProviderModel } from '../../../../shared/providers';
import { isCustomProvider } from '../../../config';
import { i18nService } from '../../../services/i18n';
import { ProviderModelDiscoveryButton } from '../ProviderModelDiscoveryButton';
import { ProviderModelRow, type ProviderModelRowActions } from '../ProviderModelRow';
import type { ModelConnectionStatus } from '../useModelConnectionStatus';
import type { ProvidersConfig, ProviderType } from './constants';
import { getEffectiveApiFormat, providerRequiresApiKey, resolveBaseUrl } from './providerUtils';

interface ProviderModelsSectionProps {
  providers: ProvidersConfig;
  activeProvider: ProviderType;
  autoDetectRequest: { provider: ProviderType; requestId: number } | null;
  isRefreshingLlamaCppModels: boolean;
  onRefreshLlamaCppModels: () => Promise<void>;
  onModelsDiscovered: (
    providerId: string,
    discoveredModels: readonly DiscoveredProviderModel[],
  ) => Promise<void>;
  onAddModel: () => void;
  getModelConnectionStatus: (provider: string, modelId: string) => ModelConnectionStatus;
  modelRowActions: ProviderModelRowActions;
}

export default function ProviderModelsSection({
  providers,
  activeProvider,
  autoDetectRequest,
  isRefreshingLlamaCppModels,
  onRefreshLlamaCppModels,
  onModelsDiscovered,
  onAddModel,
  getModelConnectionStatus,
  modelRowActions,
}: ProviderModelsSectionProps) {
  return (
    <div className={cn(isCustomProvider(activeProvider) && 'space-y-4')}>
      <div className="rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-1.5 pl-3 pr-2">
          <div className="flex min-w-0 items-center gap-2">
            <p className="text-sm font-medium text-foreground">{i18nService.t('modelList')}</p>
          </div>
          {activeProvider === ProviderName.LlamaCpp ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void onRefreshLlamaCppModels()}
                    disabled={isRefreshingLlamaCppModels}
                    aria-label={i18nService.t('refresh')}
                  >
                    <RefreshCw
                      className={
                        isRefreshingLlamaCppModels
                          ? 'animate-spin motion-reduce:animate-none'
                          : undefined
                      }
                    />
                  </Button>
                }
              />
              <TooltipContent>{i18nService.t('refresh')}</TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-1">
              <ProviderModelDiscoveryButton
                prominent={isCustomProvider(activeProvider)}
                iconOnly
                providerId={activeProvider}
                provider={providers[activeProvider]}
                baseUrl={resolveBaseUrl(
                  activeProvider,
                  providers[activeProvider].baseUrl,
                  getEffectiveApiFormat(activeProvider, providers[activeProvider].apiFormat),
                )}
                apiFormat={getEffectiveApiFormat(
                  activeProvider,
                  providers[activeProvider].apiFormat,
                )}
                requiresApiKey={
                  providerRequiresApiKey(activeProvider) &&
                  providers[activeProvider].authType !== 'oauth'
                }
                autoDetectRequest={
                  autoDetectRequest?.provider === activeProvider
                    ? {
                        providerId: activeProvider,
                        requestId: autoDetectRequest.requestId,
                      }
                    : null
                }
                onModelsDiscovered={onModelsDiscovered}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={onAddModel}
                      aria-label={i18nService.t('addModel')}
                    >
                      <PlusCircle />
                    </Button>
                  }
                />
                <TooltipContent>{i18nService.t('addModel')}</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        <div className="max-h-60 divide-y divide-border overflow-y-auto">
          {(providers[activeProvider].models ?? []).map(model => (
            <ProviderModelRow
              key={model.id}
              providerId={activeProvider}
              model={model}
              connectionStatus={getModelConnectionStatus(activeProvider, model.id)}
              onTestModel={modelRowActions.testModel}
              onEditModel={modelRowActions.editModel}
              onDeleteModel={modelRowActions.deleteModel}
            />
          ))}

          {(!providers[activeProvider].models || providers[activeProvider].models.length === 0) && (
            <div className="p-3 text-center">
              <p className={cn('text-muted-foreground', 'text-sm')}>
                {i18nService.t('noModelsAvailable')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
