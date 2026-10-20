import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MagpieUsagePeriod } from '../../shared/magpie/routingUsage';
import {
  mergeRoutingGroupSaveBody,
  projectRoutingGroups,
  projectUsageBudget,
  projectUsageQuotas,
  projectUsageRequestPage,
  projectUsageSummary,
} from './projectRoutingUsage';

const groupsFixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures/groups-state.json'), 'utf8'),
);

describe('projectRoutingUsage', () => {
  it('projects routing groups from upstream shape', () => {
    const state = projectRoutingGroups(groupsFixture);
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]).toMatchObject({
      id: 'astra',
      name: 'Astra fallback',
      routing: 'order',
      ready: true,
    });
    expect(state.models[0]?.id).toBe('relay/gpt-6-astra');
  });

  it('projects usage summary totals', () => {
    const summary = projectUsageSummary(
      { calls: 3, errors: 1, input: 100, output: 20, cost: 0.42, unpriced: 1, path: '~/log' },
      MagpieUsagePeriod.Week,
    );
    expect(summary).toMatchObject({
      period: MagpieUsagePeriod.Week,
      calls: 3,
      cost: 0.42,
    });
  });

  it('projects ledger rows and quota cards', () => {
    const page = projectUsageRequestPage(
      {
        rows: [
          {
            t: '2026-10-16T07:00:00.000Z',
            agentName: 'Codex',
            providerName: 'Relay',
            model: 'gpt-6',
            in: 10,
            out: 2,
            cost: 0.01,
            status: 200,
          },
          {
            t: '2026-10-16T06:00:00.000Z',
            agentName: 'Claude',
            providerName: 'Relay',
            model: 'gpt-6',
            in: 5,
            out: 1,
            status: 0,
            err: 'rate limited',
          },
        ],
        offset: 0,
        total: 2,
        calls: 2,
        input: 15,
        output: 3,
        cost: 0.01,
        unpriced: 0,
      },
      MagpieUsagePeriod.Today,
    );
    expect(page.rows).toHaveLength(2);
    expect(page.rows[1]?.failed).toBe(true);
    const quotas = projectUsageQuotas([
      {
        provider: 'relay',
        name: 'Relay',
        windows: [{ name: 'Weekly', used: 40 }],
      },
    ]);
    expect(quotas[0]?.windows[0]?.used).toBe(40);
    expect(projectUsageBudget({ usageAlert: 75, balanceAlert: 3.5 })).toEqual({
      usageAlertPercent: 75,
      balanceAlert: 3.5,
    });
  });

  it('merges routing group saves without dropping upstream-only fields', () => {
    const merged = mergeRoutingGroupSaveBody(
      {
        groups: [
          {
            id: 'astra',
            name: 'Astra',
            members: ['relay/a'],
            routing: 'order',
            match: ['relay/*'],
            weights: { 'relay/a': 2 },
          },
        ],
      },
      {
        id: 'astra',
        name: 'Astra renamed',
        members: ['relay/a', 'relay/b'],
        routing: 'rotate',
      },
    );
    expect(merged).toMatchObject({
      id: 'astra',
      name: 'Astra renamed',
      members: ['relay/a', 'relay/b'],
      routing: 'rotate',
      match: ['relay/*'],
      weights: { 'relay/a': 2 },
    });
  });

  it('merges routing group rename via from', () => {
    const merged = mergeRoutingGroupSaveBody(
      {
        groups: [{ id: 'old-id', name: 'Old', members: ['relay/a'], routing: 'order' }],
      },
      {
        id: 'new-id',
        name: 'Renamed',
        members: ['relay/a'],
        renameFrom: 'old-id',
      },
    );
    expect(merged).toMatchObject({
      id: 'new-id',
      name: 'Renamed',
      from: 'old-id',
    });
  });

  it('omits cost when priced is false', () => {
    const page = projectUsageRequestPage(
      {
        rows: [
          { t: '2026-10-16T07:00:00.000Z', model: 'm', in: 1, out: 1, cost: 0, priced: false },
        ],
        offset: 0,
        total: 1,
      },
      MagpieUsagePeriod.Today,
    );
    expect(page.rows[0]?.cost).toBeUndefined();
  });
});
