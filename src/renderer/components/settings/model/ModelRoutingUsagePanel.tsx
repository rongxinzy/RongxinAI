import { Button } from '@shared/components/ui/button';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  MagpieUsagePeriod,
  type MagpieRoutingState,
  type MagpieSubscriptionQuota,
  type MagpieUsageBudget,
  type MagpieUsageRequestPage,
  type MagpieUsageSummary,
} from '../../../../shared/magpie/routingUsage';
import { i18nService } from '../../../services/i18n';
import { ModelRoutingGroupsSection } from './ModelRoutingGroupsSection';
import {
  ModelRoutingCallsSection,
  ModelRoutingCostSection,
  ModelRoutingQuotaSection,
} from './ModelRoutingUsageSections';
import {
  MODEL_USAGE_TABS,
  ModelUsageTab,
  type ModelUsageTab as ModelUsageTabType,
} from './modelRoutingUsageConstants';

interface ModelRoutingUsagePanelProps {
  running: boolean;
  disabled?: boolean;
}

export function ModelRoutingUsagePanel({ running, disabled = false }: ModelRoutingUsagePanelProps) {
  const [tab, setTab] = useState<ModelUsageTabType>(ModelUsageTab.Routing);
  const [period, setPeriod] = useState<MagpieUsagePeriod>(MagpieUsagePeriod.Week);
  const [routing, setRouting] = useState<MagpieRoutingState | null>(null);
  const [quotas, setQuotas] = useState<MagpieSubscriptionQuota[] | null>(null);
  const [requests, setRequests] = useState<MagpieUsageRequestPage | null>(null);
  const [summary, setSummary] = useState<MagpieUsageSummary | null>(null);
  const [budget, setBudget] = useState<MagpieUsageBudget | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const api = window.electron.magpie;

  const loadRouting = useCallback(async () => {
    if (!api?.routingGroups) return;
    setRouting(await api.routingGroups());
  }, [api]);

  const loadQuotas = useCallback(async () => {
    if (!api?.usageQuotas) return;
    setQuotas(await api.usageQuotas(true));
  }, [api]);

  const loadCalls = useCallback(async () => {
    if (!api?.usageRequests) return;
    setRequests(await api.usageRequests(period, 0, 25));
  }, [api, period]);

  const loadCost = useCallback(async () => {
    if (!api?.usageSummary || !api?.usageBudget) return;
    const [nextSummary, nextBudget] = await Promise.all([
      api.usageSummary(period),
      api.usageBudget(),
    ]);
    setSummary(nextSummary);
    setBudget(nextBudget);
  }, [api, period]);

  const refreshTab = useCallback(async () => {
    if (!running || disabled) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === ModelUsageTab.Routing) await loadRouting();
      if (tab === ModelUsageTab.Quota) await loadQuotas();
      if (tab === ModelUsageTab.Calls) await loadCalls();
      if (tab === ModelUsageTab.Cost) await loadCost();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [disabled, loadCalls, loadCost, loadQuotas, loadRouting, running, tab]);

  useEffect(() => {
    void refreshTab();
  }, [refreshTab]);

  if (!running) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
        {i18nService.t('magpieServiceRequired')}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{i18nService.t('modelUsageTitle')}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {i18nService.t('modelUsageDescription')}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled || loading}
          onClick={() => void refreshTab()}
          aria-label={i18nService.t('modelUsageRefresh')}
          title={i18nService.t('modelUsageRefresh')}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <FluidTabs<ModelUsageTabType>
        aria-label={i18nService.t('modelUsageTabs')}
        value={tab}
        onValueChange={setTab}
        items={MODEL_USAGE_TABS.map(value => ({
          value,
          label: i18nService.t(`modelUsageTab_${value}`),
        }))}
      />

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {tab === ModelUsageTab.Routing && (
        <ModelRoutingGroupsSection
          routing={routing}
          disabled={disabled}
          onRoutingChange={setRouting}
        />
      )}
      {tab === ModelUsageTab.Quota && <ModelRoutingQuotaSection quotas={quotas} />}
      {tab === ModelUsageTab.Calls && (
        <ModelRoutingCallsSection
          period={period}
          disabled={disabled}
          requests={requests}
          onPeriodChange={setPeriod}
        />
      )}
      {tab === ModelUsageTab.Cost && (
        <ModelRoutingCostSection
          period={period}
          disabled={disabled}
          summary={summary}
          budget={budget}
          onPeriodChange={setPeriod}
        />
      )}
    </section>
  );
}
