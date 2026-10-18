import { expect, test, vi } from 'vitest';
import { PiRunEvent } from '../../../shared/cowork/runState';
import { PiEventProjectionQueue } from './piEventProjectionQueue';

test('tool results are extracted synchronously without blocking later events', async () => {
  const consumed: Array<{ type: string; displayResultText?: string }> = [];
  const controller = new AbortController();
  const queue = new PiEventProjectionQueue<{
    type: string;
    result?: unknown;
    displayResultText?: string;
  }>(event => consumed.push(event), controller.signal, vi.fn());
  queue.push({ type: PiRunEvent.ToolEnd, result: { content: [{ text: 'result' }] } });
  queue.push({ type: PiRunEvent.MessageStart });
  queue.push({ type: PiRunEvent.AgentEnd });
  await queue.drain();
  expect(consumed.map(event => event.type)).toEqual([
    PiRunEvent.ToolEnd,
    PiRunEvent.MessageStart,
    PiRunEvent.AgentEnd,
  ]);
  expect(consumed[0]?.displayResultText).toBe('result');
});

test('large structured tool results still yield display text immediately', async () => {
  const consumed: Array<{ type: string; displayResultText?: string }> = [];
  const controller = new AbortController();
  const queue = new PiEventProjectionQueue<{
    type: string;
    result?: unknown;
    displayResultText?: string;
  }>(event => consumed.push(event), controller.signal, vi.fn());
  queue.push({ type: PiRunEvent.ToolEnd, result: { content: [{ text: 'x'.repeat(70_000) }] } });
  queue.push({ type: PiRunEvent.AgentEnd });
  await queue.drain();
  expect(consumed).toHaveLength(2);
  expect(consumed[0]?.displayResultText?.length).toBe(70_000);
});

test('skips image blocks when extracting tool display text', () => {
  const controller = new AbortController();
  const queue = new PiEventProjectionQueue<{
    type: string;
    result?: unknown;
    displayResultText?: string;
  }>(
    event => {
      expect(event.displayResultText).toBe('caption only');
    },
    controller.signal,
    vi.fn(),
  );
  queue.push({
    type: PiRunEvent.ToolEnd,
    result: {
      content: [
        { type: 'text', text: 'caption only' },
        { type: 'image', data: 'a'.repeat(1000) },
      ],
    },
  });
});

test('deltas after a slow tool path are not delayed by a pending transform', async () => {
  vi.useFakeTimers();
  const consumed: string[] = [];
  const controller = new AbortController();
  const queue = new PiEventProjectionQueue<{ type: string; result?: unknown }>(
    event => consumed.push(event.type),
    controller.signal,
    vi.fn(),
  );
  const startedAt = Date.now();
  queue.push({ type: PiRunEvent.ToolEnd, result: { content: [{ text: 'tool output' }] } });
  queue.push({ type: PiRunEvent.MessageUpdate });
  queue.push({ type: PiRunEvent.AgentEnd });
  await queue.drain();
  expect(Date.now() - startedAt).toBeLessThan(50);
  expect(consumed).toEqual([PiRunEvent.ToolEnd, PiRunEvent.MessageUpdate, PiRunEvent.AgentEnd]);
  vi.useRealTimers();
});
