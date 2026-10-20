import { describe, expect, it } from 'vitest';
import type { MagpieRoutingGroup } from '../../shared/magpie/routingUsage';
import { collectRoutingGroupLeaves, routingGroupAllowed } from './routingGroupPolicy';

describe('routingGroupAllowed', () => {
  const groups = new Map<string, MagpieRoutingGroup>(
    [
      {
        id: 'mix',
        name: 'Mix',
        members: ['allowed/model', 'group/nested'],
        ready: true,
        memberInfo: [],
      },
      {
        id: 'nested',
        name: 'Nested',
        members: ['private/hidden'],
        ready: true,
        memberInfo: [],
      },
    ].map(group => [group.id, group]),
  );

  it('filters routing groups when any leaf model is disallowed', () => {
    const allowed = (model: { id: string }) => !model.id.startsWith('private/');
    expect(
      routingGroupAllowed({ id: 'group/mix', display_name: 'Friendly alias' }, groups, allowed),
    ).toBe(false);
    expect(routingGroupAllowed({ id: 'vendor/open' }, groups, allowed)).toBe(true);
  });

  it('collects nested leaf model refs without effort suffix', () => {
    expect(collectRoutingGroupLeaves('mix', groups)).toEqual(['allowed/model', 'private/hidden']);
    expect(collectRoutingGroupLeaves('group/mix', groups)).toEqual([
      'allowed/model',
      'private/hidden',
    ]);
  });

  it('keeps routing groups visible when every leaf is allowed, including effort suffixes', () => {
    const effortGroups = new Map<string, MagpieRoutingGroup>([
      [
        'pro',
        {
          id: 'pro',
          name: 'Pro',
          members: ['vendor/model:high', 'vendor/model'],
          ready: true,
          memberInfo: [],
        },
      ],
    ]);
    const allowed = (model: { id: string }) =>
      model.id === 'vendor/model' || model.id === 'vendor/model:high';
    expect(
      routingGroupAllowed({ id: 'group/pro', display_name: 'Pro bundle' }, effortGroups, allowed),
    ).toBe(true);
  });
});
