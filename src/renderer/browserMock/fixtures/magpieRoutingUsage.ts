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
      members: ['preview/open-mini', 'preview/open-large', 'group/legacy'],
      matched: ['preview/*'],
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

const callRows = Array.from({ length: 30 }, (_, index) => ({
  time: new Date(Date.UTC(2026, 9, 16, 7, index)).toISOString(),
  agentName: index % 2 === 0 ? 'Codex' : 'Claude Code',
  providerName: 'Preview',
  model: index % 3 === 0 ? 'open-large' : 'open-mini',
  input: 100 + index,
  output: 10 + index,
  cost: index % 5 === 0 ? undefined : 0.01 * (index + 1),
  failed: index === 3,
}));

export const mockMagpieUsageRequests: MagpieUsageRequestPage = {
  period: MagpieUsagePeriod.Week,
  offset: 0,
  total: 42,
  totals: {
    calls: 42,
    errors: 1,
    input: 128_400,
    output: 9_200,
    cost: 1.24,
    unpriced: 2,
  },
  rows: callRows,
};

export const mockMagpieUsageQuotas: MagpieSubscriptionQuota[] = [
  {
    provider: 'preview',
    name: 'Preview plan',
    plan: 'Team',
    user: 'workspace@example.com',
    windows: [
      {
        name: 'Weekly',
        used: 32,
        unlimited: false,
        resetsAt: '2026-10-20T00:00:00.000Z',
      },
      {
        name: 'Monthly',
        used: 68,
        unlimited: false,
        resetsAt: '2026-11-01T00:00:00.000Z',
      },
    ],
  },
];

export const mockMagpieUsageBudget: MagpieUsageBudget = {
  usageAlertPercent: 80,
  balanceAlert: 5,
};
