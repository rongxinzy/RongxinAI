import type {
  MagpieRoutingGroupSaveInput,
  MagpieRoutingState,
  MagpieSubscriptionQuota,
  MagpieUsageBudget,
  MagpieUsagePeriod,
  MagpieUsageRequestPage,
  MagpieUsageSummary,
} from '../../shared/magpie/routingUsage';
import { MagpieManager } from './manager';
import * as routingUsageApi from './routingUsageApi';

declare module './manager' {
  interface MagpieManager {
    routingGroups(): Promise<MagpieRoutingState>;
    saveRoutingGroup(input: MagpieRoutingGroupSaveInput): Promise<MagpieRoutingState>;
    deleteRoutingGroup(id: string): Promise<MagpieRoutingState>;
    arrangeRoutingGroups(order: string[]): Promise<MagpieRoutingState>;
    usageSummary(period: MagpieUsagePeriod): Promise<MagpieUsageSummary>;
    usageRequests(
      period: MagpieUsagePeriod,
      offset: number,
      limit: number,
    ): Promise<MagpieUsageRequestPage>;
    usageQuotas(asked?: boolean): Promise<MagpieSubscriptionQuota[]>;
    usageBudget(): Promise<MagpieUsageBudget>;
  }
}

MagpieManager.prototype.routingGroups = function routingGroups() {
  return routingUsageApi.routingGroups(this);
};
MagpieManager.prototype.saveRoutingGroup = function saveRoutingGroup(input) {
  return routingUsageApi.saveRoutingGroup(this, input);
};
MagpieManager.prototype.deleteRoutingGroup = function deleteRoutingGroup(id) {
  return routingUsageApi.deleteRoutingGroup(this, id);
};
MagpieManager.prototype.arrangeRoutingGroups = function arrangeRoutingGroups(order) {
  return routingUsageApi.arrangeRoutingGroups(this, order);
};
MagpieManager.prototype.usageSummary = function usageSummary(period) {
  return routingUsageApi.usageSummary(this, period);
};
MagpieManager.prototype.usageRequests = function usageRequests(period, offset, limit) {
  return routingUsageApi.usageRequests(this, period, offset, limit);
};
MagpieManager.prototype.usageQuotas = function usageQuotas(asked = false) {
  return routingUsageApi.usageQuotas(this, asked);
};
MagpieManager.prototype.usageBudget = function usageBudget() {
  return routingUsageApi.usageBudget(this);
};
