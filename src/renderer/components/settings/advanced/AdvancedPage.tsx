import { ModelPicker } from '@shared/components/model-picker/ModelPicker';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Switch } from '@shared/components/ui/switch';
import { Copy, Terminal, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import type { MagpieDiagnosticSummary } from '../../../../shared/magpie/types';
import type { MagpieRoutingState } from '../../../../shared/magpie/routingUsage';
import { i18nService } from '../../../services/i18n';
import {
  getModelPickerLabels,
  toModelPickerItem,
} from '../../../services/modelSettings/modelCapabilities';
import { classifyProviderError } from '../../../services/modelSettings/providerErrorClassifier';
import { useModelServiceAutoStart } from '../../../services/modelSettings/useModelServiceAutoStart';
import { showAppToast } from '../../../services/toastNotification';
import type { RootState } from '../../../store';
import { SettingsToggleRow } from '../../common/SettingsToggleRow';
import { MagpieSubscriptionControl } from '../model/MagpieSubscriptionControl';
import { ModelRoutingGroupsSection } from '../model/ModelRoutingGroupsSection';
import { ProviderErrorBanner } from '../model/ProviderErrorBanner';
import { useMagpiePreferences } from '../model/useMagpiePreferences';

export interface AdvancedPageProps {
  useSystemProxy: boolean;
  onUseSystemProxyChange: (next: boolean) => void;
  codemodeEnabled: boolean;
  onCodemodeEnabledChange: (next: boolean) => void;
}

export function AdvancedPage({
  useSystemProxy,
  onUseSystemProxyChange,
  codemodeEnabled,
  onCodemodeEnabledChange,
}: AdvancedPageProps) {
  const { status, refreshStatus } = useModelServiceAutoStart();
  const running = status?.state === 'running';
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const { preferences, loading, saving, update } = useMagpiePreferences(running);

  const [routing, setRouting] = useState<MagpieRoutingState | null>(null);
  const [routingError, setRoutingError] = useState(false);
  const [diagnostics, setDiagnostics] = useState<MagpieDiagnosticSummary | null>(null);
  const [selectedHiddenCandidate, setSelectedHiddenCandidate] = useState<string>('');

  const loadExtras = useCallback(async () => {
    if (!running || !window.electron?.magpie) return;
    const [nextRouting, nextDiag] = await Promise.all([
      window.electron.magpie.routingGroups?.().catch(() => null),
      window.electron.magpie.diagnostics?.().catch(() => null),
    ]);
    setRouting(nextRouting);
    setRoutingError(nextRouting === null);
    setDiagnostics(nextDiag);
  }, [running]);

  useEffect(() => {
    void loadExtras();
  }, [loadExtras]);

  const pickerItems = useMemo(() => availableModels.map(toModelPickerItem), [availableModels]);
  const pickerLabels = useMemo(() => getModelPickerLabels(), []);

  const handleToggleProxy = async (next: boolean) => {
    onUseSystemProxyChange(next);
    if (running) {
      await update({ proxy: next ? '' : 'direct' });
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">
            {i18nService.t('advancedGroupsTitle')}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {i18nService.t('advancedGroupsDesc')}
          </p>
        </div>
        <ModelRoutingGroupsSection
          routing={routing}
          disabled={!running || loading}
          loadError={routingError}
          onRoutingChange={setRouting}
        />
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">
            {i18nService.t('advancedHiddenModelsTitle')}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {i18nService.t('advancedHiddenModelsDesc')}
          </p>
        </div>
        <div className="space-y-3 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <ModelPicker
              items={pickerItems}
              selectedId={selectedHiddenCandidate || null}
              triggerClassName="w-72"
              disabled={!preferences || saving}
              labels={{
                ...pickerLabels,
                selectPlaceholder: i18nService.t('advancedHiddenModelsPickerLabel'),
              }}
              onSelect={item => setSelectedHiddenCandidate(item.id)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                !preferences ||
                saving ||
                !selectedHiddenCandidate ||
                preferences.disabledModels.includes(selectedHiddenCandidate)
              }
              onClick={() => {
                if (!preferences || !selectedHiddenCandidate) return;
                void update({
                  disabledModels: [...preferences.disabledModels, selectedHiddenCandidate],
                }).then(() => setSelectedHiddenCandidate(''));
              }}
            >
              {i18nService.t('advancedHiddenModelsAdd')}
            </Button>
          </div>
          {preferences && preferences.disabledModels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {preferences.disabledModels.map(pattern => (
                <Badge key={pattern} variant="secondary" className="gap-1.5">
                  <span className="font-mono text-xs">{pattern}</span>
                  <button
                    type="button"
                    aria-label={i18nService.t('magpieRemove')}
                    onClick={() =>
                      void update({
                        disabledModels: preferences.disabledModels.filter(item => item !== pattern),
                      })
                    }
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-base font-medium text-foreground">
          {i18nService.t('advancedNetworkTitle')}
        </h3>
        <div className="divide-y divide-border rounded-lg border border-border bg-card px-4">
          <SettingsToggleRow
            labelHeadingLevel={4}
            label={i18nService.t('useSystemProxy')}
            description={i18nService.t('advancedProxySyncHint')}
            checked={useSystemProxy}
            onCheckedChange={checked => void handleToggleProxy(checked)}
          />
          {preferences && (
            <div className="flex items-center justify-between gap-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  {i18nService.t('magpieBareIds')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {i18nService.t('magpieBareIdsHint')}
                </div>
              </div>
              <Switch
                checked={preferences.bareModelIDs}
                disabled={saving}
                aria-label={i18nService.t('magpieBareIds')}
                onCheckedChange={bareModelIDs => void update({ bareModelIDs })}
              />
            </div>
          )}
        </div>
      </section>

      {preferences?.gateway && (
        <section className="space-y-4">
          <h3 className="text-base font-medium text-foreground">
            {i18nService.t('advancedLocalApiTitle')}
          </h3>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <code className="truncate text-xs text-foreground">{preferences.gateway}</code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => {
                void navigator.clipboard.writeText(preferences.gateway);
                showAppToast(i18nService.t('copiedToClipboard'));
              }}
            >
              <Copy className="size-3.5" />
              <span>{i18nService.t('copy')}</span>
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium text-foreground">
            {i18nService.t('advancedDiagnosticsTitle')}
          </h3>
          {diagnostics && (diagnostics.recentErrors?.length ?? 0) > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                void window.electron.magpie.clearDiagnostics().then(next => setDiagnostics(next))
              }
            >
              {i18nService.t('magpieDiagnosticsClear')}
            </Button>
          )}
        </div>
        <div className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm">
          {diagnostics ? (
            (diagnostics.recentErrors?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">
                {i18nService.t('magpieDiagnosticsNoErrors')}
              </p>
            ) : (
              (diagnostics.recentErrors ?? []).slice(0, 5).map((item, idx) => (
                <ProviderErrorBanner
                  key={`${item.timestamp}-${idx}`}
                  classified={classifyProviderError({
                    raw: item.message,
                    providerName: item.providerId,
                  })}
                />
              ))
            )
          ) : (
            <p className="text-xs text-muted-foreground">{i18nService.t('magpieState_stopped')}</p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-base font-medium text-foreground">
          {i18nService.t('advancedExperimentalTitle')}
        </h3>
        <div className="divide-y divide-border rounded-lg border border-border bg-card px-4">
          <SettingsToggleRow
            labelHeadingLevel={4}
            label={i18nService.t('codemodeEnabled')}
            description={i18nService.t('codemodeEnabledDescription')}
            checked={codemodeEnabled}
            onCheckedChange={onCodemodeEnabledChange}
          />
          {status && (
            <div className="py-3.5">
              <MagpieSubscriptionControl
                status={status}
                disabled={!running}
                onStatusChange={() => void refreshStatus()}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-4 py-3.5">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Terminal className="size-4 text-muted-foreground" />
              <span>{i18nService.t('advancedDevTitle')}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void window.electron?.window?.openDevTools?.()}
            >
              DevTools
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
