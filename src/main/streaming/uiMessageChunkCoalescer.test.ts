import { afterEach, expect, test, vi } from 'vitest';

import { UiMessageChunkCoalescer } from './uiMessageChunkCoalescer';

afterEach(() => vi.useRealTimers());

test('merges consecutive text deltas for the same part id', () => {
  vi.useFakeTimers();
  const emitted: unknown[] = [];
  const coalescer = new UiMessageChunkCoalescer(
    payload => emitted.push(payload),
    () => 0,
  );
  coalescer.push('s', 'm', { type: 'text-start', id: 'm:0' });
  coalescer.push('s', 'm', { type: 'text-delta', id: 'm:0', delta: 'a' });
  coalescer.push('s', 'm', { type: 'text-delta', id: 'm:0', delta: 'b' });
  vi.advanceTimersByTime(32);
  expect(emitted).toHaveLength(2);
  expect(emitted[1]).toMatchObject({ chunk: { type: 'text-delta', delta: 'ab' } });
});

test('flushes before a different event type and preserves order', () => {
  vi.useFakeTimers();
  const emitted: unknown[] = [];
  const coalescer = new UiMessageChunkCoalescer(
    payload => emitted.push(payload),
    () => 0,
  );
  coalescer.push('s', 'm', { type: 'text-delta', id: 'm:0', delta: 'x' });
  coalescer.push('s', 'm', { type: 'text-end', id: 'm:0' });
  expect(emitted).toHaveLength(2);
  expect(emitted.map(entry => (entry as { chunk: { type: string } }).chunk.type)).toEqual([
    'text-delta',
    'text-end',
  ]);
});

test('flushes early when coalesce char budget is exceeded', () => {
  vi.useFakeTimers();
  const emitted: unknown[] = [];
  const coalescer = new UiMessageChunkCoalescer(
    payload => emitted.push(payload),
    () => 0,
  );
  const big = 'x'.repeat(2048);
  coalescer.push('s', 'm', { type: 'text-delta', id: 'm:0', delta: big });
  coalescer.push('s', 'm', { type: 'text-delta', id: 'm:0', delta: 'y' });
  expect(emitted).toHaveLength(1);
  expect((emitted[0] as { chunk: { delta: string } }).chunk.delta.length).toBeGreaterThanOrEqual(
    2048,
  );
});

test('flush emits a pending delta', () => {
  vi.useFakeTimers();
  const emitted: unknown[] = [];
  const coalescer = new UiMessageChunkCoalescer(
    payload => emitted.push(payload),
    () => 0,
  );
  coalescer.push('s', 'm', { type: 'text-delta', id: 'm:0', delta: 'tail' });
  coalescer.flush();
  expect(emitted).toHaveLength(1);
});
