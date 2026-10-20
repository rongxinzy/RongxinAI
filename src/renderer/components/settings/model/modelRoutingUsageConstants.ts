import { MagpieProviderRouting, MagpieUsagePeriod } from '../../../../shared/magpie/routingUsage';
import { i18nService } from '../../../services/i18n';

export const ModelUsageTab = {
  Routing: 'routing',
  Quota: 'quota',
  Calls: 'calls',
  Cost: 'cost',
} as const;
export type ModelUsageTab = (typeof ModelUsageTab)[keyof typeof ModelUsageTab];

export const MODEL_USAGE_TABS = [
  ModelUsageTab.Routing,
  ModelUsageTab.Quota,
  ModelUsageTab.Calls,
  ModelUsageTab.Cost,
] as const;

export const MODEL_USAGE_PERIODS = [
  MagpieUsagePeriod.Today,
  MagpieUsagePeriod.Week,
  MagpieUsagePeriod.Month,
  MagpieUsagePeriod.All,
] as const;

export const MODEL_ROUTING_OPTIONS = [
  MagpieProviderRouting.Ordered,
  MagpieProviderRouting.Rotate,
  MagpieProviderRouting.LeastUsed,
  MagpieProviderRouting.Pace,
  MagpieProviderRouting.Weighted,
  MagpieProviderRouting.Manual,
] as const;

export const usagePeriodLabel = (period: MagpieUsagePeriod) =>
  i18nService.t(`modelUsagePeriod_${period}`);
