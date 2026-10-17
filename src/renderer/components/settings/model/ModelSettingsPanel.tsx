import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
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
import { MagpieAgentsPanel } from '../../coding/MagpieAgentsPanel';
import { MagpieSubscriptionControl } from './MagpieSubscriptionControl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { ModelCatalogBrowser } from './ModelCatalogBrowser';
import { ProviderManagerSection } from './ProviderManagerSection';

export default function ModelSettingsPanel() {
  const [catalog, setCatalog] = useState<MagpieModelCatalog | null>(null);
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);
  const [providers, setProviders] = useState<MagpieProviderSummary[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<MagpieDiagnosticSummary | null>(null);
  const [externalAgentsOpen, setExternalAgentsOpen] = useState(false);
  const mounted = useRef(false);
  const locked = useRef(false);
  const actionVersion = useRef(0);

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
  return (
    <section className="max-w-2xl space-y-4" aria-busy={busy}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{i18nService.t('magpieCatalogTitle')}</h2>
        {(catalog || starting) && (
          <Badge variant="outline" role="status">
            {i18nService.t(`magpieState_${starting ? 'starting' : catalog?.status.state}`)}
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{i18nService.t('magpieCatalogHint')}</p>
      <p className="text-sm text-muted-foreground">{i18nService.t('magpieCatalogConsent')}</p>
      {busy && !catalog && <p role="status">{i18nService.t('modelBrowseLoading')}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {i18nService.t('magpieActionFailed')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!running && (
          <Button
            type="button"
            disabled={
              busy || catalog?.status.state === 'starting' || catalog?.status.state === 'stopping'
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
        <Button
          type="button"
          variant="outline"
          disabled={busy || !running}
          onClick={() => void run(() => window.electron.magpie.openManagement())}
        >
          {i18nService.t('magpieOpenManagement')}
        </Button>
      </div>

      {running && diagnostics && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 px-3.5 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {i18nService.t('magpieDiagnosticsTitle')}:
          </span>
          <Badge variant="outline" className="text-[11px] font-normal">
            {i18nService.t('magpieDiagnosticsActive')}: {diagnostics.activeProviderCount}
          </Badge>
          {diagnostics.latencyMs !== undefined && (
            <span>
              {i18nService.t('magpieDiagnosticsLatency')}: {diagnostics.latencyMs}ms
            </span>
          )}
          {diagnostics.recentErrors && diagnostics.recentErrors.length > 0 && (
            <Badge
              variant="destructive"
              className="max-w-xs truncate text-[11px] font-normal"
              title={diagnostics.recentErrors[0].message}
            >
              {diagnostics.recentErrors[0].message}
            </Badge>
          )}
        </div>
      )}

      {running && (
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
      )}

      {running && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">{i18nService.t('magpieDefaultModel')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={busy || !selected || selection === catalog.defaultModelId}
                onClick={() =>
                  void run(async () => apply(await selectMagpieDefaultModel(selection), true))
                }
              >
                {i18nService.t('magpieSetDefault')}
              </Button>
            </div>
          </div>
          {!models.length && (
            <p className="text-sm text-muted-foreground">{i18nService.t('magpieCatalogEmpty')}</p>
          )}
          <ModelCatalogBrowser
            models={models}
            defaultModelId={catalog.defaultModelId}
            selection={selection}
            disabled={busy}
            onSelect={setSelection}
          />
        </>
      )}
      <div className="space-y-2 rounded-xl border border-border-subtle p-4">
        <p className="text-sm font-medium">{i18nService.t('magpieExternalSettingsLink')}</p>
        <p className="text-sm text-muted-foreground">
          {i18nService.t('magpieExternalSettingsLinkHint')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setExternalAgentsOpen(true)}
        >
          {i18nService.t('magpieExternalSettingsLink')}
        </Button>
      </div>

      <Dialog open={externalAgentsOpen} onOpenChange={setExternalAgentsOpen}>
        <DialogContent className="theme-control-sizing-4 flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col gap-4 overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{i18nService.t('magpieTitle')}</DialogTitle>
            <DialogDescription>{i18nService.t('magpieExternalPanelDescription')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {externalAgentsOpen ? <MagpieAgentsPanel /> : null}
          </div>
        </DialogContent>
      </Dialog>

      {catalog && (
        <MagpieSubscriptionControl
          status={catalog.status}
          disabled={busy || !running}
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
      )}
      <p className="text-xs text-muted-foreground">{i18nService.t('magpieLicenseNotice')}</p>
    </section>
  );
}
