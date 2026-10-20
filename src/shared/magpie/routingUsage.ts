export const MAGPIE_ROUTING_GROUP_PREFIX = 'group/';

export const MagpieUsagePeriod = {
  Today: 'today',
  Week: '7d',
  Month: '30d',
  All: 'all',
} as const;
export type MagpieUsagePeriod = (typeof MagpieUsagePeriod)[keyof typeof MagpieUsagePeriod];

export const MagpieProviderRouting = {
  Smart: '',
  Ordered: 'order',
  Rotate: 'rotate',
  LeastUsed: 'usage',
  Pace: 'pace',
  Weighted: 'weight',
  Manual: 'manual',
} as const;
export type MagpieProviderRouting =
  (typeof MagpieProviderRouting)[keyof typeof MagpieProviderRouting];

export interface MagpieRoutingMemberInfo {
  id: string;
  ready: boolean;
  provider?: string;
  name?: string;
  model?: string;
  group?: boolean;
  providerOff?: boolean;
}

export interface MagpieRoutingGroup {
  id: string;
  name: string;
  members: string[];
  routing?: string;
  affinity?: string;
  off?: string[];
  ready: boolean;
  memberInfo: MagpieRoutingMemberInfo[];
}

export interface MagpieRoutingModelRef {
  id: string;
  name: string;
  provider: string;
  providerName: string;
}

export interface MagpieRoutingState {
  groups: MagpieRoutingGroup[];
  models: MagpieRoutingModelRef[];
}

export interface MagpieRoutingGroupSaveInput {
  id: string;
  name: string;
  members: string[];
  routing?: string;
  affinity?: string;
  off?: string[];
  /** When set and different from id, renames an existing group (upstream `from`). */
  renameFrom?: string;
}

export interface MagpieUsageTotals {
  calls: number;
  errors: number;
  input: number;
  output: number;
  cost: number;
  unpriced: number;
}

export interface MagpieUsageSummary extends MagpieUsageTotals {
  period: MagpieUsagePeriod;
}

export interface MagpieUsageRequestRow {
  time: string;
  agentName: string;
  providerName: string;
  model: string;
  input: number;
  output: number;
  cost?: number;
  failed: boolean;
}

export interface MagpieUsageRequestPage {
  period: MagpieUsagePeriod;
  rows: MagpieUsageRequestRow[];
  offset: number;
  total: number;
  totals: MagpieUsageTotals;
}

export interface MagpieQuotaWindow {
  name: string;
  used?: number;
  unlimited?: boolean;
  resetsAt?: string;
}

export interface MagpieSubscriptionQuota {
  provider: string;
  name: string;
  plan?: string;
  user?: string;
  windows: MagpieQuotaWindow[];
  balance?: string;
  error?: string;
}

export interface MagpieUsageBudget {
  usageAlertPercent: number;
  balanceAlert: number;
}
