import { describe, expect, test } from 'vitest';
import { boundWorkerInput } from './boundedWorkerInput';

describe('boundWorkerInput', () => {
  test('rejects oversized inputs when toolText is false', () => {
    const bigArray = new Array(600).fill('item');
    expect(() =>
      boundWorkerInput(bigArray, {
        nodes: 512,
        depth: 8,
        characters: 100_000,
        toolText: false,
      }),
    ).toThrow('Worker input limit exceeded.');
  });

  test('gracefully truncates oversized tool outputs when toolText is true', () => {
    const bigArray = new Array(600).fill('item');
    const result = boundWorkerInput(bigArray, {
      nodes: 512,
      depth: 8,
      characters: 100_000,
      toolText: true,
    }) as string[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(513);
    expect(result[result.length - 1]).toBe('[Truncated 88 items]');
  });

  test('gracefully truncates deep structures when toolText is true', () => {
    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 15; i++) {
      deep = { next: deep };
    }

    const result = boundWorkerInput(deep, {
      nodes: 512,
      depth: 5,
      characters: 100_000,
      toolText: true,
    }) as Record<string, unknown>;

    expect(result).toBeTruthy();
    let current: unknown = result;
    let depth = 0;
    while (
      current &&
      typeof current === 'object' &&
      'next' in current &&
      (current as Record<string, unknown>).next
    ) {
      current = (current as Record<string, unknown>).next;
      depth++;
    }
    expect(depth).toBeLessThanOrEqual(6);
    expect(current).toBe('[Truncated]');
  });
});
