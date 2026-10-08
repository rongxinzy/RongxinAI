import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { cn } from '@shared/lib/utils';
import { X } from 'lucide-react';

import { isProviderEnabled, ProviderRegistry } from '../../../../shared/providers';
import { getProviderDisplayName, isCustomProvider } from '../../../config';
import { getProviderIcon } from '../../../providers/uiRegistry';
import { i18nService } from '../../../services/i18n';
import {
  CUSTOM_PROVIDER_KEYS,
  type ProviderConfig,
  type ProvidersConfig,
  type ProviderType,
} from './constants';
import {
  getCustomProviderLabel,
  hasProviderAuthConfigured,
  providerRequiresApiKey,
} from './providerUtils';

interface ProviderListColumnProps {
  visibleProviders: ProvidersConfig;
  providers: ProvidersConfig;
  activeProvider: ProviderType;
  isImportingProviders: boolean;
  isExportingProviders: boolean;
  importInputRef: React.RefObject<HTMLInputElement | null>;
  onImportClick: () => void;
  onImportFile: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onProviderChange: (provider: ProviderType) => void;
  onAddCustomProvider: () => void;
  onDeleteCustomProvider: (provider: ProviderType) => void;
  onToggleProviderEnabled: (provider: ProviderType) => void;
}

export default function ProviderListColumn({
  visibleProviders,
  providers,
  activeProvider,
  isImportingProviders,
  isExportingProviders,
  importInputRef,
  onImportClick,
  onImportFile,
  onExport,
  onProviderChange,
  onAddCustomProvider,
  onDeleteCustomProvider,
  onToggleProviderEnabled,
}: ProviderListColumnProps) {
  return (
    <div className="min-h-0 max-h-56 w-full shrink-0 space-y-1 overflow-y-auto border-b border-border px-2 md:max-h-none md:w-2/5 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-sm font-medium text-foreground">{i18nService.t('modelProviders')}</h3>
        <div className="flex items-center space-x-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onImportClick}
            disabled={isImportingProviders || isExportingProviders}
          >
            {i18nService.t('import')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={isImportingProviders || isExportingProviders}
          >
            {i18nService.t('export')}
          </Button>
        </div>
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={onImportFile}
      />
      {Object.entries(visibleProviders).map(([provider, config]) => {
        const providerKey = provider as ProviderType;
        const isCustom = isCustomProvider(provider);
        const hasValidAuth = hasProviderAuthConfigured(providerKey, config);
        const providerEnabled = isProviderEnabled(providerKey, config);
        const effectiveEnabled = providerRequiresApiKey(providerKey)
          ? providerEnabled && hasValidAuth
          : providerEnabled;
        const canToggleProvider = effectiveEnabled || hasValidAuth;
        const displayLabel = isCustom
          ? (config as ProviderConfig).displayName || getCustomProviderLabel(provider)
          : (ProviderRegistry.get(providerKey)?.label ?? getProviderDisplayName(provider));
        return (
          <div
            key={provider}
            role="button"
            tabIndex={0}
            onClick={() => onProviderChange(providerKey)}
            onKeyDown={e => {
              if (e.target !== e.currentTarget) return;
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onProviderChange(providerKey);
            }}
            className={cn(
              'theme-surface-provider-row group flex items-center p-2 cursor-pointer',
              activeProvider === provider
                ? 'theme-surface-provider-selected'
                : 'theme-surface-provider-idle',
            )}
          >
            <div className="flex flex-1 items-center min-w-0">
              <div className="mr-2 flex h-7 w-7 items-center justify-center shrink-0">
                <span className="text-foreground">{getProviderIcon(provider)}</span>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate text-foreground">{displayLabel}</span>
                {isCustom && (
                  <span className="text-xs leading-tight mt-0.5 text-primary">
                    {i18nService.t('customBadge')}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center ml-2 gap-1">
              {isCustom && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="theme-page-settings-button-1"
                  onClick={e => {
                    e.stopPropagation();
                    onDeleteCustomProvider(providerKey);
                  }}
                  title={i18nService.t('deleteCustomProvider')}
                  aria-label={i18nService.t('deleteCustomProvider')}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
              <Switch
                checked={effectiveEnabled}
                onCheckedChange={() => {
                  if (!canToggleProvider) return;
                  onToggleProviderEnabled(providerKey);
                }}
                className={!canToggleProvider ? 'pointer-events-none cursor-not-allowed' : ''}
              />
            </div>
          </div>
        );
      })}
      {/* Add Custom Provider Button */}
      {CUSTOM_PROVIDER_KEYS.some(k => !providers[k]) && (
        <Button
          type="button"
          variant="outline"
          onClick={onAddCustomProvider}
          className="theme-page-settings-button-2 w-full"
        >
          {i18nService.t('addCustomProvider')}
        </Button>
      )}
    </div>
  );
}
