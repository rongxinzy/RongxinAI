import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MagpieDiagnosticSummary,
  MagpieModelCatalog,
  MagpieProviderSummary,
  MagpieSaveProviderInput,
} from '../../../../shared/magpie/types';
import {
  applyMagpieCatalog,
  refreshMagpieModels,
  selectMagpieDefaultModel,
} from '../../../services/availableModels';
import { i18nService } from '../../../services/i18n';
import { showAppError } from '../../../services/appToast';
import { neutralRuntimeName } from '../../../services/runtimeNameNeutralizer';
import { MagpieAgentsPanel } from '../../coding/MagpieAgentsPanel';
import { MagpieAboutPreferences } from './MagpieAboutPreferences';
import { MagpieModelPreferences } from './MagpieModelPreferences';
import { MagpieNetworkPreferences } from './MagpieNetworkPreferences';
import { MagpiePrivacyPreferences } from './MagpiePrivacyPreferences';
import { MagpieSubscriptionControl } from './MagpieSubscriptionControl';
import { ModelCatalogBrowser } from './ModelCatalogBrowser';
import { ModelRoutingUsagePanel } from './ModelRoutingUsagePanel';
import { ProviderManagerSection } from './ProviderManagerSection';
import { useMagpiePreferences } from './useMagpiePreferences';

const ModelSection = {
  Service: 'service',
  Agents: 'agents',
  Providers: 'providers',
  RoutingUsage: 'routingUsage',
  Models: 'models',
  Network: 'network',
  Privacy: 'privacy',
  About: 'about',
} as const;
type ModelSection = (typeof ModelSection)[keyof typeof ModelSection];

const MODEL_SECTIONS = [
  ModelSection.Service,
  ModelSection.Agents,
  ModelSection.Providers,
  ModelSection.RoutingUsage,
  ModelSection.Models,
  ModelSection.Network,
  ModelSection.Privacy,
  ModelSection.About,
] as const;

const SECTION_LABEL_KEYS: Record<ModelSection, string> = {
  [ModelSection.Service]: 'magpieSectionService',
  [ModelSection.Agents]: 'magpieSectionAgents',
  [ModelSection.Providers]: 'magpieSectionProviders',
  [ModelSection.RoutingUsage]: 'magpieSectionRoutingUsage',
  [ModelSection.Models]: 'magpieSectionModels',
  [ModelSection.Network]: 'magpieSectionNetwork',
  [ModelSection.Privacy]: 'magpieSectionPrivacy',
  [ModelSection.About]: 'magpieSectionAbout',
};

export default function ModelSettingsPanel() {
  const [section, setSection] = useState<ModelSection>(ModelSection.Service);
  const [compactSections, setCompactSections] = useState(
    () => window.matchMedia('(max-width: 1100px)').matches,
  );
  const [catalog, setCatalog] = useState<MagpieModelCatalog | null>(null);
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);
  const [providers, setProviders] = useState<MagpieProviderSummary[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<MagpieDiagnosticSummary | null>(null);
  const mounted = useRef(false);
  const locked = useRef(false);
  const actionVersion = useRef(0);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1100px)');
    const onChange = () => setCompactSections(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const loadProviders = useCallback(async () => {
    if (!window.electron.magpie?.providers) return;
    setProvidersLoading(true);
    try {
      const list = await window.electron.magpie.providers();
      if (mounted.current) setProviders(list);
      if (window.electron.magpie.diagnostics) {
        const diag = await window.electron.magpie.diagnostics();
        if (mounted.current) setDiagnostics(diag);
      }
    } catch {
      /* ignore */
    } finally {
      if (mounted.current) setProvidersLoading(false);
    }
  }, []);

  const apply = (next: MagpieModelCatalog, confirmed = false) => {
    if (!mounted.current) return;
    setCatalog(next);
    setSelection(previous =>
      !confirmed && next.models.some(model => model.id === previous)
        ? previous
        : (next.defaultModelId ?? ''),
    );
  };
  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    actionVersion.current += 1;
    setBusy(true);
    setError(false);
    try {
      await action();
    } catch {
      if (mounted.current) setError(true);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void run(async () => {
      apply(await refreshMagpieModels());
      await loadProviders();
    });
    const timer = window.setInterval(() => {
      if (locked.current) return;
      const version = actionVersion.current;
      void window.electron.magpie
        .status()
        .then(status => {
          if (
            !mounted.current ||
            locked.current ||
            version !== actionVersion.current ||
            status.state === 'running'
          )
            return;
          const next = { status, models: [], defaultModelId: null };
          applyMagpieCatalog(next);
          apply(next);
        })
        .catch(() => {
          if (mounted.current) setError(true);
        });
    }, 3000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [loadProviders]);
  const handleSaveProvider = async (input: MagpieSaveProviderInput) => {
    try {
      const updated = await window.electron.magpie.saveProvider(input);
      setProviders(updated);
      apply(await refreshMagpieModels());
      return true;
    } catch (err: unknown) {
      showAppError(err instanceof Error ? err.message : 'Save provider failed');
      return false;
    }
  };

  const handleToggleProvider = async (id: string, enabled: boolean) => {
    try {
      const updated = await window.electron.magpie.setProviderEnabled(id, enabled);
      setProviders(updated);
      apply(await refreshMagpieModels());
      return true;
    } catch (err: unknown) {
      showAppError(err instanceof Error ? err.message : 'Toggle provider failed');
      return false;
    }
  };

  const handleDeleteProvider = async (id: string) => {
    try {
      const updated = await window.electron.magpie.deleteProvider(id);
      setProviders(updated);
      apply(await refreshMagpieModels());
      return true;
    } catch (err: unknown) {
      showAppError(err instanceof Error ? err.message : 'Delete provider failed');
      return false;
    }
  };

  const handleTestProvider = async (input: MagpieSaveProviderInput) => {
    return window.electron.magpie.testProvider(input);
  };

  const running = catalog?.status.state === 'running';
  const models = running ? catalog.models : [];
  const selected = models.find(model => model.id === selection);
  const saved = models.find(model => model.id === catalog?.defaultModelId);
  const needsPreferences =
    running &&
    section !== ModelSection.Service &&
    section !== ModelSection.Agents &&
    section !== ModelSection.Providers;
  const {
    preferences,
    saving,
    error: preferencesError,
    update,
  } = useMagpiePreferences(needsPreferences);

  const preferencesUnavailable = (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
      {running ? i18nService.t('magpiePreferencesLoading') : i18nService.t('magpieServiceRequired')}
    </div>
  );

  return (
    <section className="flex flex-col gap-6" aria-busy={busy}>
      {compactSections ? (
        <Select
          items={Object.fromEntries(
            MODEL_SECTIONS.map(value => [value, i18nService.t(SECTION_LABEL_KEYS[value])]),
          )}
          value={section}
          onValueChange={next => {
            if (next) setSection(next as ModelSection);
          }}
        >
          <SelectTrigger aria-label={i18nService.t('magpieSettingsSections')} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_SECTIONS.map(value => (
              <SelectItem key={value} value={value}>
                {i18nService.t(SECTION_LABEL_KEYS[value])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="max-w-full overflow-x-auto pb-1">
          <FluidTabs<ModelSection>
            aria-label={i18nService.t('magpieSettingsSections')}
            value={section}
            onValueChange={setSection}
            items={MODEL_SECTIONS.map(value => ({
              value,
              label: i18nService.t(SECTION_LABEL_KEYS[value]),
            }))}
          />
        </div>
      )}

      {section === ModelSection.Service && (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{i18nService.t('magpieCatalogTitle')}</h2>
                {(catalog || starting) && (
                  <Badge variant="outline" role="status">
                    {i18nService.t(`magpieState_${starting ? 'starting' : catalog?.status.state}`)}
                  </Badge>
                )}
              </div>
              <p className="max-w-prose text-sm text-muted-foreground">
                {i18nService.t('magpieCatalogHint')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!running && (
                <Button
                  type="button"
                  disabled={
                    busy ||
                    catalog?.status.state === 'starting' ||
                    catalog?.status.state === 'stopping'
                  }
                  onClick={() =>
                    void run(async () => {
                      setStarting(true);
                      try {
                        const status = await window.electron.magpie.start();
                        const next = { status, models: [], defaultModelId: null };
                        applyMagpieCatalog(next);
                        apply(next);
                        if (status.state !== 'running') throw new Error('Not running');
                        apply(await refreshMagpieModels());
                        await loadProviders();
                      } finally {
                        if (mounted.current) setStarting(false);
                      }
                    })
                  }
                >
                  {i18nService.t('magpieCatalogEnable')}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    apply(await refreshMagpieModels());
                    await loadProviders();
                  })
                }
              >
                {i18nService.t('magpieCatalogRefresh')}
              </Button>
            </div>
            {!running && (
              <p className="max-w-prose text-sm text-muted-foreground">
                {i18nService.t('magpieCatalogConsent')}
              </p>
            )}
            {busy && !catalog && <p role="status">{i18nService.t('modelBrowseLoading')}</p>}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {i18nService.t('magpieActionFailed')}
              </p>
            )}
          </section>

          {running && diagnostics && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border-subtle bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {i18nService.t('magpieDiagnosticsTitle')}
              </span>
              <span>
                {i18nService.t('magpieDiagnosticsActive')}: {diagnostics.activeProviderCount}
              </span>
              {diagnostics.latencyMs !== undefined && (
                <span>
                  {i18nService.t('magpieDiagnosticsLatency')}: {diagnostics.latencyMs}ms
                </span>
              )}
              {diagnostics.recentErrors && diagnostics.recentErrors.length > 0 && (
                <Badge
                  variant="destructive"
                  className="max-w-full truncate font-normal"
                  title={neutralRuntimeName(diagnostics.recentErrors[0].message)}
                >
                  {neutralRuntimeName(diagnostics.recentErrors[0].message)}
                </Badge>
              )}
            </div>
          )}

          {running && (
            <section className="flex flex-col gap-4 border-t border-border pt-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className="text-base font-semibold">{i18nService.t('magpieDefaultModel')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {i18nService.t('modelBrowseSaved')}:{' '}
                    {saved?.display_name || saved?.id || i18nService.t('magpieModelUnset')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {i18nService.t('magpieDefaultModelHint')}
                  </p>
                </div>
                {selected && selection !== catalog?.defaultModelId && (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => apply(await selectMagpieDefaultModel(selection), true))
                    }
                  >
                    {i18nService.t('magpieSetDefault')}
                  </Button>
                )}
              </div>
              {!models.length && (
                <p className="text-sm text-muted-foreground">
                  {i18nService.t('magpieCatalogEmpty')}
                </p>
              )}
              <ModelCatalogBrowser
                models={models}
                defaultModelId={catalog?.defaultModelId ?? null}
                selection={selection}
                disabled={busy}
                onSelect={setSelection}
              />
            </section>
          )}
        </div>
      )}

      {section === ModelSection.Agents && (
        <section className="flex flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-base font-semibold">
              {i18nService.t('magpieExternalSettingsLink')}
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">
              {i18nService.t('magpieExternalSettingsLinkHint')}
            </p>
          </div>
          {running ? <MagpieAgentsPanel /> : preferencesUnavailable}
        </section>
      )}

      {section === ModelSection.Providers && (
        <div className="flex flex-col gap-4">
          {running ? (
            <ProviderManagerSection
              providers={providers}
              loading={providersLoading}
              disabled={busy}
              onRefresh={loadProviders}
              onSaveProvider={handleSaveProvider}
              onToggleProvider={handleToggleProvider}
              onDeleteProvider={handleDeleteProvider}
              onTestProvider={handleTestProvider}
            />
          ) : (
            preferencesUnavailable
          )}
        </div>
      )}

      {section === ModelSection.RoutingUsage && (
        <ModelRoutingUsagePanel running={running} disabled={busy} />
      )}

      {section === ModelSection.Models && (
        <div className="flex flex-col gap-4">
          {preferences ? (
            <MagpieModelPreferences preferences={preferences} saving={saving} update={update} />
          ) : (
            preferencesUnavailable
          )}
          {preferencesError ? (
            <p role="alert" className="text-sm text-destructive">
              {preferencesError}
            </p>
          ) : null}
        </div>
      )}

      {section === ModelSection.Network && (
        <div className="flex flex-col gap-4">
          {preferences ? (
            <MagpieNetworkPreferences preferences={preferences} saving={saving} update={update} />
          ) : (
            preferencesUnavailable
          )}
          {preferencesError ? (
            <p role="alert" className="text-sm text-destructive">
              {preferencesError}
            </p>
          ) : null}
        </div>
      )}

      {section === ModelSection.Privacy && (
        <div className="flex flex-col gap-6">
          {preferences ? (
            <MagpiePrivacyPreferences preferences={preferences} saving={saving} update={update} />
          ) : (
            preferencesUnavailable
          )}
          {preferencesError ? (
            <p role="alert" className="text-sm text-destructive">
              {preferencesError}
            </p>
          ) : null}
          {running && catalog ? (
            <div className="border-t border-border pt-6">
              <MagpieSubscriptionControl
                status={catalog.status}
                disabled={busy || saving}
                onBusyChange={value => {
                  locked.current = value;
                  actionVersion.current += 1;
                  setBusy(value);
                }}
                onStatusChange={async status => {
                  const next = { status, models: [], defaultModelId: null };
                  applyMagpieCatalog(next);
                  apply(next);
                  if (status.state === 'running') apply(await refreshMagpieModels());
                }}
              />
            </div>
          ) : null}
        </div>
      )}

      {section === ModelSection.About && (
        <div className="flex flex-col gap-4">
          {preferences ? (
            <MagpieAboutPreferences preferences={preferences} />
          ) : (
            <div className="flex flex-col gap-2">
              {preferencesUnavailable}
              {catalog?.status.version ? (
                <p className="text-sm text-muted-foreground">
                  {i18nService.t('aboutVersion')}: {catalog.status.version}
                </p>
              ) : null}
            </div>
          )}
          {preferencesError ? (
            <p role="alert" className="text-sm text-destructive">
              {preferencesError}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
