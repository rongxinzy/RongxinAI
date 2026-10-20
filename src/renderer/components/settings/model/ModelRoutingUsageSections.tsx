import { Badge } from '@shared/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import {
  MagpieUsagePeriod,
  type MagpieSubscriptionQuota,
  type MagpieUsageBudget,
  type MagpieUsageRequestPage,
  type MagpieUsageSummary,
} from '../../../../shared/magpie/routingUsage';
import { i18nService } from '../../../services/i18n';
import { MODEL_USAGE_PERIODS, usagePeriodLabel } from './modelRoutingUsageConstants';

interface PeriodSelectProps {
  period: MagpieUsagePeriod;
  disabled?: boolean;
  onPeriodChange: (period: MagpieUsagePeriod) => void;
}

function UsagePeriodSelect({ period, disabled, onPeriodChange }: PeriodSelectProps) {
  return (
    <Select
      items={Object.fromEntries(MODEL_USAGE_PERIODS.map(value => [value, usagePeriodLabel(value)]))}
      value={period}
      onValueChange={value => {
        if (value) onPeriodChange(value as MagpieUsagePeriod);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-[min(100%,12rem)]" aria-label={i18nService.t('modelUsagePeriod')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {MODEL_USAGE_PERIODS.map(value => (
          <SelectItem key={value} value={value}>
            {usagePeriodLabel(value)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ModelRoutingQuotaSection({ quotas }: { quotas: MagpieSubscriptionQuota[] | null }) {
  if (!quotas?.length) {
    return <p className="text-sm text-muted-foreground">{i18nService.t('modelQuotaEmpty')}</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {quotas.map(quota => (
        <li
          key={`${quota.provider}-${quota.user ?? quota.name}`}
          className="rounded-lg border border-border-subtle px-4 py-3"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{quota.name}</p>
            {quota.plan ? <Badge variant="outline">{quota.plan}</Badge> : null}
          </div>
          {quota.user ? (
            <p className="truncate text-sm text-muted-foreground">{quota.user}</p>
          ) : null}
          {quota.balance ? <p className="text-sm text-foreground">{quota.balance}</p> : null}
          {quota.error ? (
            <p className="text-sm text-destructive">{quota.error}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
              {quota.windows.map(window => (
                <li key={window.name}>
                  {window.name}
                  {window.unlimited
                    ? ` · ${i18nService.t('modelQuotaUnlimited')}`
                    : typeof window.used === 'number'
                      ? ` · ${window.used}%`
                      : ''}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

interface ModelRoutingCallsSectionProps {
  period: MagpieUsagePeriod;
  disabled?: boolean;
  requests: MagpieUsageRequestPage | null;
  onPeriodChange: (period: MagpieUsagePeriod) => void;
}

export function ModelRoutingCallsSection({
  period,
  disabled,
  requests,
  onPeriodChange,
}: ModelRoutingCallsSectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <UsagePeriodSelect period={period} disabled={disabled} onPeriodChange={onPeriodChange} />
      {!requests?.rows.length ? (
        <p className="text-sm text-muted-foreground">{i18nService.t('modelCallsEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border-subtle text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{i18nService.t('modelCallsTime')}</th>
                <th className="px-3 py-2 font-medium">{i18nService.t('modelCallsAgent')}</th>
                <th className="px-3 py-2 font-medium">{i18nService.t('modelCallsModel')}</th>
                <th className="px-3 py-2 font-medium">{i18nService.t('modelCallsTokens')}</th>
                <th className="px-3 py-2 font-medium">{i18nService.t('modelCallsCost')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.rows.map(row => (
                <tr key={`${row.time}-${row.model}`} className="border-b border-border-subtle/60">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {new Date(row.time).toLocaleString()}
                  </td>
                  <td className="max-w-[8rem] truncate px-3 py-2">{row.agentName}</td>
                  <td className="max-w-[10rem] truncate px-3 py-2">{row.model}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {row.input + row.output}
                    {row.failed ? (
                      <Badge variant="destructive" className="ml-2 font-normal">
                        {i18nService.t('modelCallsFailed')}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {typeof row.cost === 'number' ? `$${row.cost.toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface ModelRoutingCostSectionProps {
  period: MagpieUsagePeriod;
  disabled?: boolean;
  summary: MagpieUsageSummary | null;
  budget: MagpieUsageBudget | null;
  onPeriodChange: (period: MagpieUsagePeriod) => void;
}

export function ModelRoutingCostSection({
  period,
  disabled,
  summary,
  budget,
  onPeriodChange,
}: ModelRoutingCostSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      <UsagePeriodSelect period={period} disabled={disabled} onPeriodChange={onPeriodChange} />
      {summary ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border-subtle px-4 py-3">
            <dt className="text-sm text-muted-foreground">{i18nService.t('modelCostCalls')}</dt>
            <dd className="text-lg font-semibold">{summary.calls}</dd>
          </div>
          <div className="rounded-lg border border-border-subtle px-4 py-3">
            <dt className="text-sm text-muted-foreground">{i18nService.t('modelCostTotal')}</dt>
            <dd className="text-lg font-semibold">
              {summary.cost > 0
                ? `≈$${summary.cost.toFixed(2)}`
                : i18nService.t('modelCostNoPrice')}
            </dd>
          </div>
          <div className="rounded-lg border border-border-subtle px-4 py-3">
            <dt className="text-sm text-muted-foreground">{i18nService.t('modelCostTokens')}</dt>
            <dd className="text-lg font-semibold">{summary.input + summary.output}</dd>
          </div>
          <div className="rounded-lg border border-border-subtle px-4 py-3">
            <dt className="text-sm text-muted-foreground">{i18nService.t('modelCostErrors')}</dt>
            <dd className="text-lg font-semibold">{summary.errors}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">{i18nService.t('modelCostEmpty')}</p>
      )}
      {budget ? (
        <div className="rounded-lg border border-border-subtle px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{i18nService.t('modelBudgetTitle')}</p>
          <p>
            {i18nService
              .t('modelBudgetUsageAlert')
              .replace(
                '{percent}',
                budget.usageAlertPercent > 0
                  ? String(budget.usageAlertPercent)
                  : i18nService.t('modelBudgetOff'),
              )}
          </p>
          <p>
            {i18nService
              .t('modelBudgetBalanceAlert')
              .replace(
                '{amount}',
                budget.balanceAlertUsd > 0
                  ? `$${budget.balanceAlertUsd.toFixed(2)}`
                  : i18nService.t('modelBudgetOff'),
              )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
