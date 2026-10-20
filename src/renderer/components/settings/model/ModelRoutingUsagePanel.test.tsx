// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MagpieUsagePeriod } from '../../../../shared/magpie/routingUsage';
import { ModelRoutingUsagePanel } from './ModelRoutingUsagePanel';

vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));

const routingGroups = vi.fn();
const usageQuotas = vi.fn();
const usageRequests = vi.fn();
const usageSummary = vi.fn();
const usageBudget = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      magpie: {
        routingGroups,
        usageQuotas,
        usageRequests,
        usageSummary,
        usageBudget,
      },
    },
  });
  routingGroups.mockResolvedValue({
    groups: [
      {
        id: 'fast',
        name: 'Fast',
        members: ['vendor/model'],
        routing: 'order',
        ready: true,
        memberInfo: [{ id: 'vendor/model', ready: true }],
      },
    ],
    models: [
      { id: 'vendor/model', name: 'Vendor model', provider: 'vendor', providerName: 'Vendor' },
    ],
  });
  usageQuotas.mockResolvedValue([
    { provider: 'vendor', name: 'Vendor', windows: [{ name: 'Weekly', used: 12 }] },
  ]);
  usageRequests.mockResolvedValue({
    period: MagpieUsagePeriod.Week,
    offset: 0,
    total: 1,
    totals: { calls: 1, errors: 0, input: 1, output: 1, cost: 0, unpriced: 0 },
    rows: [
      {
        time: '2026-10-16T07:00:00.000Z',
        agentName: 'Codex',
        providerName: 'Vendor',
        model: 'vendor/model',
        input: 1,
        output: 1,
        failed: false,
      },
    ],
  });
  usageSummary.mockResolvedValue({
    period: MagpieUsagePeriod.Week,
    path: '~/usage',
    calls: 1,
    errors: 0,
    input: 1,
    output: 1,
    cost: 0.5,
    unpriced: 0,
  });
  usageBudget.mockResolvedValue({ usageAlertPercent: 80, balanceAlert: 5 });
});

afterEach(() => cleanup());

test('loads routing, quota, call log and cost tabs when running', async () => {
  render(<ModelRoutingUsagePanel running />);
  await waitFor(() => expect(routingGroups).toHaveBeenCalled());
  expect(screen.getByText('Fast')).toBeTruthy();

  fireEvent.click(screen.getByRole('tab', { name: 'modelUsageTab_quota' }));
  await waitFor(() => expect(usageQuotas).toHaveBeenCalled());
  expect(screen.getByText('Vendor')).toBeTruthy();

  fireEvent.click(screen.getByRole('tab', { name: 'modelUsageTab_calls' }));
  await waitFor(() => expect(usageRequests).toHaveBeenCalled());
  expect(screen.getByText('Codex')).toBeTruthy();

  fireEvent.click(screen.getByRole('tab', { name: 'modelUsageTab_cost' }));
  await waitFor(() => expect(usageSummary).toHaveBeenCalled());
  expect(screen.getByText('≈$0.50')).toBeTruthy();
});

test('shows service required message when not running', () => {
  render(<ModelRoutingUsagePanel running={false} />);
  expect(screen.getByText('magpieServiceRequired')).toBeTruthy();
});
