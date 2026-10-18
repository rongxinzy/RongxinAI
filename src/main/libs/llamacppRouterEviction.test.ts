import { describe, expect, test, vi } from 'vitest';

import { LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN } from './llamacppRouterStatus';
import {
  evictIdleLlamaCppRouterModelsForLoad,
  planLlamaCppRouterEviction,
} from './llamacppRouterEviction';

const IDLE_SLOTS = { busy: false, processingSlots: 0, totalSlots: 4 };
const BUSY_SLOTS = { busy: true, processingSlots: 1, totalSlots: 4 };

describe('planLlamaCppRouterEviction', () => {
  test('never targets a model whose slots are processing or unknown', () => {
    const plan = planLlamaCppRouterEviction({
      candidates: [
        { modelName: 'streaming', lastUsedAt: 100, routerOrder: 0 },
        { modelName: 'unreachable', lastUsedAt: 200, routerOrder: 1 },
        { modelName: 'idle', lastUsedAt: 300, routerOrder: 2 },
      ],
      slotsByModel: new Map([
        ['streaming', BUSY_SLOTS],
        ['unreachable', LLAMACPP_ROUTER_SLOTS_BUSY_UNKNOWN],
        ['idle', IDLE_SLOTS],
      ]),
    });

    expect(plan.evictable).toEqual(['idle']);
    expect(plan.protected).toEqual([
      { modelName: 'streaming', reason: 'busy' },
      { modelName: 'unreachable', reason: 'unknown' },
    ]);
  });

  test('a missing slots probe is treated as unknown and protected', () => {
    const plan = planLlamaCppRouterEviction({
      candidates: [{ modelName: 'idle', routerOrder: 0 }],
      slotsByModel: new Map(),
    });

    expect(plan.evictable).toEqual([]);
    expect(plan.protected).toEqual([{ modelName: 'idle', reason: 'unknown' }]);
  });

  test('orders evictable models least-recently-used first', () => {
    const plan = planLlamaCppRouterEviction({
      candidates: [
        { modelName: 'fresh', lastUsedAt: 900, routerOrder: 2 },
        { modelName: 'stale', lastUsedAt: 100, routerOrder: 1 },
        { modelName: 'middling', lastUsedAt: 500, routerOrder: 0 },
      ],
      slotsByModel: new Map([
        ['fresh', IDLE_SLOTS],
        ['stale', IDLE_SLOTS],
        ['middling', IDLE_SLOTS],
      ]),
    });

    expect(plan.evictable).toEqual(['stale', 'middling', 'fresh']);
    expect(plan.protected).toEqual([]);
  });

  test('falls back to router listing order when last-used is unavailable', () => {
    const plan = planLlamaCppRouterEviction({
      candidates: [
        { modelName: 'third', routerOrder: 2 },
        { modelName: 'first', routerOrder: 0 },
        { modelName: 'second', routerOrder: 1 },
      ],
      slotsByModel: new Map([
        ['third', IDLE_SLOTS],
        ['first', IDLE_SLOTS],
        ['second', IDLE_SLOTS],
      ]),
    });

    expect(plan.evictable).toEqual(['first', 'second', 'third']);
  });

  test('treats a missing last-used timestamp as never used (evicted first)', () => {
    const plan = planLlamaCppRouterEviction({
      candidates: [
        { modelName: 'tracked', lastUsedAt: 50, routerOrder: 0 },
        { modelName: 'untracked', routerOrder: 1 },
      ],
      slotsByModel: new Map([
        ['tracked', IDLE_SLOTS],
        ['untracked', IDLE_SLOTS],
      ]),
    });

    expect(plan.evictable).toEqual(['untracked', 'tracked']);
  });

  test('ignores blank and duplicate candidate names', () => {
    const plan = planLlamaCppRouterEviction({
      candidates: [
        { modelName: '  ', routerOrder: 0 },
        { modelName: 'idle', routerOrder: 1 },
        { modelName: 'idle', routerOrder: 2 },
      ],
      slotsByModel: new Map([['idle', IDLE_SLOTS]]),
    });

    expect(plan.evictable).toEqual(['idle']);
    expect(plan.protected).toEqual([]);
  });
});

describe('evictIdleLlamaCppRouterModelsForLoad', () => {
  const idle = async () => false;
  const busy = async () => true;

  test('evicts idle models LRU-first until the running count is under the limit', async () => {
    const stopped: string[] = [];
    const evicted = await evictIdleLlamaCppRouterModelsForLoad({
      limit: 2,
      runningModelNames: ['smol', 'qwen', 'llama'],
      targetModelName: 'smol',
      slotsBusy: async name => name === 'llama',
      stopModel: async name => {
        stopped.push(name);
      },
    });

    // Two busy-safe models ('smol' excluded as target, 'llama' busy) leave only
    // 'qwen' evictable, which is not enough for the limit: nothing partial.
    expect(evicted).toEqual(['qwen']);
    expect(stopped).toEqual(['qwen']);
  });

  test('never evicts a model whose slots are busy or unknown', async () => {
    const stopped: string[] = [];
    const evicted = await evictIdleLlamaCppRouterModelsForLoad({
      limit: 1,
      runningModelNames: ['streaming', 'unreachable', 'idle'],
      targetModelName: 'target',
      slotsBusy: async name => name !== 'idle',
      stopModel: async name => {
        stopped.push(name);
      },
    });

    expect(evicted).toEqual(['idle']);
    expect(stopped).toEqual(['idle']);
  });

  test('returns nothing when every candidate is protected and the caller still over the limit', async () => {
    const evicted = await evictIdleLlamaCppRouterModelsForLoad({
      limit: 1,
      runningModelNames: ['streaming', 'unreachable'],
      targetModelName: 'target',
      slotsBusy: busy,
      stopModel: vi.fn(),
    });

    expect(evicted).toEqual([]);
  });

  test('evicts multiple idle models when one is not enough', async () => {
    const stopped: string[] = [];
    const evicted = await evictIdleLlamaCppRouterModelsForLoad({
      limit: 1,
      runningModelNames: ['a', 'b', 'c'],
      targetModelName: 'target',
      slotsBusy: idle,
      stopModel: async name => {
        stopped.push(name);
      },
    });

    // limit 1 means the target needs an empty slate: all three go, LRU order.
    expect(evicted).toEqual(['a', 'b', 'c']);
    expect(stopped).toEqual(['a', 'b', 'c']);
  });
});
