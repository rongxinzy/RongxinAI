import { ModelPicker } from '@shared/components/model-picker/ModelPicker';
import { Button } from '@shared/components/ui/button';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import type { AISphereSnapshot } from '../../../../shared/aisphere';
import type {
  MagpieProviderSummary,
  MagpieSaveProviderInput,
} from '../../../../shared/magpie/types';
import { AISphereStatus } from '../../../../shared/aisphere';
import { refreshMagpieModels, selectMagpieDefaultModel } from '../../../services/availableModels';
import { i18nService } from '../../../services/i18n';
import {
  getModelPickerLabels,
  getRecentModelIds,
  recordRecentModelId,
  toModelPickerItem,
} from '../../../services/modelSettings/modelCapabilities';
import {
  classifyProviderError,
  type ClassifiedProviderError,
  type ProviderErrorAction,
} from '../../../services/modelSettings/providerErrorClassifier';
import type { ConsolidatedProviderPreset } from '../../../services/modelSettings/providerPresets';
import { useModelServiceAutoStart } from '../../../services/modelSettings/useModelServiceAutoStart';
import { showAppToast } from '../../../services/toastNotification';
import type { RootState } from '../../../store';
import { AddProviderWizard } from './AddProviderWizard';
import { ConfiguredProvidersSection } from './ConfiguredProvidersSection';
import { EditProviderDialog } from './EditProviderDialog';
import { ModelsZeroState } from './ModelsZeroState';
import { OrgPlatformBanner, OrgPlatformConnectDialog } from './OrgPlatformBanner';
import { ScenarioModelsSection } from './ScenarioModelsSection';
import { useMagpiePreferences } from './useMagpiePreferences';

export interface ModelsPageProps {
  onNavigateTab?: (tab: 'advanced' | 'usage') => void;
  onOpenLocalModels?: () => void;
  showLocalModelsEntry?: boolean;
}

export function ModelsPage({
  onNavigateTab,
  onOpenLocalModels,
  showLocalModelsEntry = true,
}: ModelsPageProps) {
  const { status, isStarting, startError, retryStart } = useModelServiceAutoStart();
  const running = status?.state === 'running';
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const defaultSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const { preferences, update: updatePreferences } = useMagpiePreferences(running);

  const [providers, setProviders] = useState<MagpieProviderSummary[]>([]);
  const [orgSnapshot, setOrgSnapshot] = useState<AISphereSnapshot | null>(null);
  const [providerErrors, setProviderErrors] = useState<Record<string, ClassifiedProviderError>>({});
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardPreset, setWizardPreset] = useState<ConsolidatedProviderPreset | null>(null);
  const [editingProvider, setEditingProvider] = useState<MagpieProviderSummary | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<MagpieProviderSummary | null>(null);
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [subsRestartBanner, setSubsRestartBanner] = useState(false);
  const [subsBusy, setSubsBusy] = useState(false);

  const refreshAll = useCallback(async () => {
    try {
      const [nextProviders, nextOrg] = await Promise.all([
        window.electron?.magpie?.providers?.().catch(() => []) ?? [],
        window.electron?.managedProviders?.aisphereSnapshot?.().catch(() => null) ?? null,
      ]);
      setProviders(nextProviders);
      setOrgSnapshot(nextOrg);
      await refreshMagpieModels();
    } catch (error) {
      console.error('[ModelsPage] Failed to refresh model catalog:', error);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [running, refreshAll]);

  useEffect(() => {
    const unsubscribe = window.electron?.managedProviders?.onChanged?.(() => {
      void refreshAll();
    });
    return () => {
      unsubscribe?.();
    };
  }, [refreshAll]);

  const pickerItems = useMemo(() => availableModels.map(toModelPickerItem), [availableModels]);
  const pickerLabels = useMemo(
    () =>
      getModelPickerLabels({
        manageAction: onNavigateTab ? i18nService.t('modelsPickerManageAction') : undefined,
      }),
    [onNavigateTab],
  );
  const recentIds = useMemo(() => getRecentModelIds(), []);

  const personalProviders = useMemo(() => providers.filter(p => !p.isHostManaged), [providers]);

  const orgConnected = Boolean(
    orgSnapshot?.address && orgSnapshot.status !== AISphereStatus.Unconfigured,
  );
  const isZeroState =
    !orgConnected &&
    personalProviders.length === 0 &&
    availableModels.length === 0 &&
    !status?.subscriptionAccountsEnabled &&
    !isStarting;

  const handleSaveNewProvider = async (
    input: MagpieSaveProviderInput,
    defaultModelToSelect?: string,
  ) => {
    const savedList = await window.electron.magpie.saveProvider(input);
    setProviders(savedList);
    await refreshMagpieModels();
    if (defaultModelToSelect) {
      await selectMagpieDefaultModel(defaultModelToSelect);
      recordRecentModelId(defaultModelToSelect);
    }
    showAppToast(i18nService.t('savedSuccessfully'));
  };

  const handleSaveEditedProvider = async (input: MagpieSaveProviderInput) => {
    const savedList = await window.electron.magpie.saveProvider(input);
    setProviders(savedList);
    setProviderErrors(prev => {
      if (!input.id || !prev[input.id]) return prev;
      const copy = { ...prev };
      delete copy[input.id];
      return copy;
    });
    await refreshMagpieModels();
    showAppToast(i18nService.t('savedSuccessfully'));
  };

  const handleTestProviderRow = async (provider: MagpieProviderSummary, overrideUrl?: string) => {
    setTestingProviderId(provider.id);
    try {
      const result = await window.electron.magpie.testProvider({
        id: provider.id,
        name: provider.name,
        api: provider.api,
        baseUrl: overrideUrl ?? provider.baseUrl,
        models: provider.models,
        fallback: provider.fallback,
      });
      if (result.ok) {
        setProviderErrors(prev => {
          const copy = { ...prev };
          delete copy[provider.id];
          return copy;
        });
        showAppToast(i18nService.t('magpieTestSuccess'));
      } else {
        setProviderErrors(prev => ({
          ...prev,
          [provider.id]: classifyProviderError({
            testResult: result,
            providerName: provider.name,
            baseUrl: overrideUrl ?? provider.baseUrl,
          }),
        }));
      }
    } catch (error) {
      setProviderErrors(prev => ({
        ...prev,
        [provider.id]: classifyProviderError({
          raw: error instanceof Error ? error.message : String(error),
          providerName: provider.name,
          baseUrl: overrideUrl ?? provider.baseUrl,
        }),
      }));
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleRowErrorAction = async (
    provider: MagpieProviderSummary,
    action: ProviderErrorAction,
    suggestedBaseUrl?: string,
  ) => {
    if (action === 'fix_v1' && suggestedBaseUrl) {
      await window.electron.magpie.saveProvider({
        id: provider.id,
        name: provider.name,
        api: provider.api,
        baseUrl: suggestedBaseUrl,
        models: provider.models,
        fallback: provider.fallback,
        contexts: provider.contexts,
      });
      await handleTestProviderRow(provider, suggestedBaseUrl);
      await refreshAll();
    } else if (action === 'reenter_key' || action === 'manual_models') {
      setEditingProvider(provider);
    } else if (action === 'open_network') {
      onNavigateTab?.('advanced');
    } else if (action === 'open_usage') {
      onNavigateTab?.('usage');
    } else if (action === 'retry') {
      await handleTestProviderRow(provider);
    }
  };

  const handleToggleSubscriptions = async (enabled: boolean) => {
    setSubsBusy(true);
    try {
      if (status?.state !== 'running' && window.electron?.magpie?.start) {
        const started = await window.electron.magpie.start();
        if (started.state !== 'running') {
          throw new Error(started.error || i18nService.t('magpieGatewayStartFailedHint'));
        }
      }
      await window.electron.magpie.setSubscriptionAccounts(enabled);
      setSubsRestartBanner(true);
      await refreshAll();
    } catch (error) {
      showAppToast({
        message: error instanceof Error ? error.message : i18nService.t('saveFailed'),
        isError: true,
      });
    } finally {
      setSubsBusy(false);
    }
  };

  const handleDisconnectOrg = async () => {
    try {
      const next = await window.electron.managedProviders.aisphereDisconnect();
      setOrgSnapshot(next);
      await refreshAll();
    } catch (error) {
      showAppToast({
        message: error instanceof Error ? error.message : i18nService.t('saveFailed'),
        isError: true,
      });
    }
  };

  return (
    <div className="space-y-8">
      {(isStarting || startError) && !running && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <div className="flex items-center gap-2.5 text-muted-foreground">
            {isStarting && <Loader2 className="size-4 animate-spin" />}
            <span>
              {startError
                ? i18nService.t('magpieGatewayStartFailedHint')
                : i18nService.t('modelsServiceStarting')}
            </span>
          </div>
          {startError && (
            <Button type="button" variant="outline" size="sm" onClick={() => void retryStart()}>
              {i18nService.t('providerErrRetry')}
            </Button>
          )}
        </div>
      )}

      {orgSnapshot && orgConnected && (
        <OrgPlatformBanner
          snapshot={orgSnapshot}
          onRefresh={async () => {
            const next = await window.electron.managedProviders.aisphereRefresh();
            setOrgSnapshot(next);
            await refreshMagpieModels();
          }}
          onDisconnect={handleDisconnectOrg}
        />
      )}

      {isZeroState ? (
        <ModelsZeroState
          showLocalModelsOption={showLocalModelsEntry}
          enablingSubscriptions={subsBusy}
          onSelectPreset={selected => {
            setWizardPreset(selected);
            setWizardOpen(true);
          }}
          onOpenCustomWizard={() => {
            setWizardPreset(null);
            setWizardOpen(true);
          }}
          onOpenLocalModels={onOpenLocalModels}
          onEnableLocalSubscriptions={() => void handleToggleSubscriptions(true)}
          onConnectOrganization={() => setOrgDialogOpen(true)}
        />
      ) : (
        <>
          <section className="space-y-4">
            <div>
              <h3 className="text-base font-medium text-foreground">
                {i18nService.t('modelsDefaultSectionTitle')}
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {i18nService.t('modelsDefaultSectionDesc')}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {i18nService.t('modelsDefaultModelLabel')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {i18nService.t('modelsPickerDefaultHint')}
                </div>
              </div>
              <ModelPicker
                items={pickerItems}
                selectedId={defaultSelectedModel?.id || null}
                recentIds={recentIds}
                align="end"
                triggerClassName="w-72"
                labels={pickerLabels}
                onSelect={item => {
                  recordRecentModelId(item.id);
                  void selectMagpieDefaultModel(item.id);
                }}
                onManageModels={onNavigateTab ? () => onNavigateTab('advanced') : undefined}
              />
            </div>
          </section>

          {preferences && (
            <ScenarioModelsSection
              preferences={preferences}
              pickerLabels={pickerLabels}
              onUpdate={updatePreferences}
            />
          )}

          <ConfiguredProvidersSection
            personalProviders={personalProviders}
            orgConnected={orgConnected}
            providerErrors={providerErrors}
            testingProviderId={testingProviderId}
            showLocalModelsEntry={showLocalModelsEntry}
            subscriptionAccountsEnabled={Boolean(status?.subscriptionAccountsEnabled)}
            subsBusy={subsBusy}
            subsRestartBanner={subsRestartBanner}
            onAddProvider={() => {
              setWizardPreset(null);
              setWizardOpen(true);
            }}
            onTestProvider={p => void handleTestProviderRow(p)}
            onEditProvider={setEditingProvider}
            onDeleteProvider={setDeletingProvider}
            onToggleProviderEnabled={(p, checked) => {
              void window.electron.magpie.setProviderEnabled(p.id, checked).then(next => {
                setProviders(next);
                return refreshMagpieModels();
              });
            }}
            onRowErrorAction={(p, action, url) => void handleRowErrorAction(p, action, url)}
            onOpenLocalModels={onOpenLocalModels}
            onToggleSubscriptions={checked => void handleToggleSubscriptions(checked)}
            onDismissRestartBanner={() => setSubsRestartBanner(false)}
            onRelaunchApp={() => void window.electron.appInfo.relaunch()}
            onOpenOrgDialog={() => setOrgDialogOpen(true)}
          />
        </>
      )}

      <AddProviderWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        initialPreset={wizardPreset}
        onSave={handleSaveNewProvider}
        onOpenNetworkSettings={onNavigateTab ? () => onNavigateTab('advanced') : undefined}
        onOpenUsageSettings={onNavigateTab ? () => onNavigateTab('usage') : undefined}
      />

      {editingProvider && (
        <EditProviderDialog
          open={Boolean(editingProvider)}
          onOpenChange={open => {
            if (!open) setEditingProvider(null);
          }}
          provider={editingProvider}
          onSave={handleSaveEditedProvider}
          onOpenNetworkSettings={onNavigateTab ? () => onNavigateTab('advanced') : undefined}
          onOpenUsageSettings={onNavigateTab ? () => onNavigateTab('usage') : undefined}
        />
      )}

      <OrgPlatformConnectDialog
        open={orgDialogOpen}
        onOpenChange={setOrgDialogOpen}
        initialAddress={orgSnapshot?.address ?? ''}
        onConnected={next => {
          setOrgSnapshot(next);
          void refreshAll();
        }}
      />

      <DestructiveConfirmDialog
        open={Boolean(deletingProvider)}
        title={i18nService.t('magpieDeleteProviderTitle')}
        description={i18nService.t('magpieDeleteProviderDescription')}
        cancelLabel={i18nService.t('cancel')}
        confirmLabel={i18nService.t('delete')}
        onCancel={() => setDeletingProvider(null)}
        onConfirm={() => {
          const target = deletingProvider;
          setDeletingProvider(null);
          if (!target) return;
          void window.electron.magpie.deleteProvider(target.id).then(next => {
            setProviders(next);
            return refreshMagpieModels();
          });
        }}
      />
    </div>
  );
}
