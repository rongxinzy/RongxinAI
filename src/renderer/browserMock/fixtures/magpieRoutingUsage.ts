import { MagpieUsagePeriod } from '../../../shared/magpie/routingUsage';
import type {
  MagpieRoutingState,
  MagpieSubscriptionQuota,
  MagpieUsageBudget,
  MagpieUsageRequestPage,
  MagpieUsageSummary,
} from '../../../shared/magpie/routingUsage';

export const mockMagpieRoutingPopulated: MagpieRoutingState = {
  groups: [
    {
      id: 'fast-fallback',
      name: 'Fast fallback',
      members: ['preview/open-mini', 'preview/open-large'],
      routing: 'order',
      ready: true,
      memberInfo: [
        {
          id: 'preview/open-mini',
          ready: true,
          provider: 'preview',
          name: 'Preview',
          model: 'open-mini',
        },
        {
          id: 'preview/open-large',
          ready: true,
          provider: 'preview',
          name: 'Preview',
          model: 'open-large',
        },
      ],
    },
  ],
  models: [
    { id: 'preview/open-mini', name: 'Open mini', provider: 'preview', providerName: 'Preview' },
    { id: 'preview/open-large', name: 'Open large', provider: 'preview', providerName: 'Preview' },
  ],
};

export const mockMagpieRoutingEmpty: MagpieRoutingState = {
  groups: [],
  models: [
    { id: 'preview-model', name: 'Preview model', provider: 'preview', providerName: 'Preview' },
  ],
};

export const mockMagpieUsageSummary: MagpieUsageSummary = {
  period: MagpieUsagePeriod.Week,
  calls: 42,
  errors: 1,
  input: 128_400,
  output: 9_200,
  cost: 1.24,
  unpriced: 2,
};

export const mockMagpieUsageRequests: MagpieUsageRequestPage = {
  period: MagpieUsagePeriod.Week,
  offset: 0,
  total: 2,
  totals: {
    calls: 42,
    errors: 1,
    input: 128_400,
    output: 9_200,
    cost: 1.24,
    unpriced: 2,
  },
  rows: [
    {
      time: '2026-10-16T07:12:00.000Z',
      agentName: 'Codex',
      providerName: 'Preview',
      model: 'open-large',
      input: 4200,
      output: 380,
      cost: 0.08,
      failed: false,
    },
    {
      time: '2026-10-16T06:40:00.000Z',
      agentName: 'Claude Code',
      providerName: 'Preview',
      model: 'open-mini',
      input: 2100,
      output: 120,
      failed: true,
    },
  ],
};

export const mockMagpieUsageQuotas: MagpieSubscriptionQuota[] = [
  {
    provider: 'preview',
    name: 'Preview plan',
    plan: 'Team',
    user: 'workspace@example.com',
    windows: [
      { name: 'Weekly', used: 32, unlimited: false },
      { name: 'Monthly', used: 68, unlimited: false },
    ],
  },
];

export const mockMagpieUsageBudget: MagpieUsageBudget = {
  usageAlertPercent: 80,
  balanceAlert: 5,
};
