import { FluidTabs, FluidTabsSize } from '@shared/components/ui/fluid-tabs';
import { useCallback, useEffect, useState } from 'react';
import {
  MagpieUsagePeriod,
  type MagpieSubscriptionQuota,
  type MagpieUsageBudget,
  type MagpieUsageRequestPage,
  type MagpieUsageSummary,
} from '../../../../shared/magpie/routingUsage';
import { i18nService } from '../../../services/i18n';
import { useModelServiceAutoStart } from '../../../services/modelSettings/useModelServiceAutoStart';
import {
  ModelRoutingCallsSection,
  ModelRoutingCostSection,
  ModelRoutingQuotaSection,
} from '../model/ModelRoutingUsageSections';

const PAGE_SIZE = 20;

const PERIOD_OPTIONS = [
  MagpieUsagePeriod.Today,
  MagpieUsagePeriod.Week,
  MagpieUsagePeriod.Month,
  MagpieUsagePeriod.All,
] as const;

export function UsagePage() {
  const { status } = useModelServiceAutoStart();
  const running = status?.state === 'running';
  const [period, setPeriod] = useState<MagpieUsagePeriod>(MagpieUsagePeriod.Week);
  const [offset, setOffset] = useState(0);
  const [quotas, setQuotas] = useState<MagpieSubscriptionQuota[] | null>(null);
  const [summary, setSummary] = useState<MagpieUsageSummary | null>(null);
  const [budget, setBudget] = useState<MagpieUsageBudget | null>(null);
  const [requests, setRequests] = useState<MagpieUsageRequestPage | null>(null);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!running || !window.electron?.magpie) return;
    setLoading(true);
    try {
      const [nextQuotas, nextSummary, nextBudget, nextRequests] = await Promise.all([
        window.electron.magpie.usageQuotas?.().catch(() => null),
        window.electron.magpie.usageSummary?.(period).catch(() => null),
        window.electron.magpie.usageBudget?.().catch(() => null),
        window.electron.magpie.usageRequests?.(period, offset, PAGE_SIZE).catch(() => null),
      ]);
      setQuotas(nextQuotas ?? null);
      setSummary(nextSummary ?? null);
      setBudget(nextBudget ?? null);
      setRequests(nextRequests ?? null);
    } finally {
      setLoading(false);
    }
  }, [offset, period, running]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const periodItems = PERIOD_OPTIONS.map(p => ({
    value: p,
    label: i18nService.t(`modelUsagePeriod_${p}`),
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{i18nService.t('usagePageDescription')}</p>
        <FluidTabs
          aria-label={i18nService.t('modelUsagePeriod')}
          size={FluidTabsSize.Small}
          items={periodItems}
          value={period}
          onValueChange={next => {
            setPeriod(next);
            setOffset(0);
          }}
        />
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-medium text-foreground">
          {i18nService.t('usageBudgetsTitle')}
        </h3>
        <ModelRoutingCostSection
          period={period}
          disabled={loading}
          summary={summary}
          budget={budget}
          onPeriodChange={next => {
            setPeriod(next);
            setOffset(0);
          }}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-medium text-foreground">
          {i18nService.t('usageQuotasTitle')}
        </h3>
        <ModelRoutingQuotaSection quotas={quotas} />
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-medium text-foreground">
          {i18nService.t('usageRecentCallsTitle')}
        </h3>
        <ModelRoutingCallsSection
          period={period}
          disabled={loading}
          requests={requests}
          pageSize={PAGE_SIZE}
          offset={offset}
          onPeriodChange={next => {
            setPeriod(next);
            setOffset(0);
          }}
          onOffsetChange={setOffset}
        />
      </section>
    </div>
  );
}
