import { expect, test, vi } from 'vitest';
import { PiRunEvent } from '../../../shared/cowork/runState';
import { PiAgentEventType } from './piStreamConstants';
import { PiEventProjection } from './piEventProjection';

test('tool results are extracted synchronously without blocking later events', async () => {
  const consumed: Array<{ type: string; displayResultText?: string }> = [];
  const controller = new AbortController();
  const queue = new PiEventProjection<{
    type: string;
    result?: unknown;
    displayResultText?: string;
  }>([event => consumed.push(event)], controller.signal, vi.fn());
  queue.push({ type: PiRunEvent.ToolEnd, result: { content: [{ text: 'result' }] } });
  queue.push({ type: PiRunEvent.MessageStart });
  queue.push({ type: PiRunEvent.AgentEnd });
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
  const queue = new PiEventProjection<{
    type: string;
    result?: unknown;
    displayResultText?: string;
  }>([event => consumed.push(event)], controller.signal, vi.fn());
  queue.push({ type: PiRunEvent.ToolEnd, result: { content: [{ text: 'x'.repeat(70_000) }] } });
  queue.push({ type: PiRunEvent.AgentEnd });
  expect(consumed).toHaveLength(2);
  expect(consumed[0]?.displayResultText?.length).toBe(70_000);
});

test('skips image blocks when extracting tool display text', () => {
  const controller = new AbortController();
  const consumed: string[] = [];
  const queue = new PiEventProjection<{
    type: string;
    result?: unknown;
    displayResultText?: string;
  }>(
    [
      event => {
        consumed.push(event.displayResultText ?? '');
      },
    ],
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
  expect(consumed).toEqual(['caption only']);
});

test('observer failure cannot skip independent observers or latch subsequent events', () => {
  const received: string[] = [];
  const error = new Error('display unavailable');
  const report = vi.fn();
  const projection = new PiEventProjection<{ type: string }>(
    [
      () => {
        throw error;
      },
      event => {
        received.push(event.type);
      },
    ],
    new AbortController().signal,
    report,
  );
  projection.push({ type: PiAgentEventType.MessageEnd });
  projection.push({ type: PiAgentEventType.AgentSettled });
  expect(received).toEqual([PiAgentEventType.MessageEnd, PiAgentEventType.AgentSettled]);
  expect(report.mock.calls).toEqual([[error], [error]]);
});

test('reporter failure cannot reject Pi events and aborted projections skip callbacks', () => {
  const controller = new AbortController();
  const observe = vi.fn(() => {
    throw new Error('display unavailable');
  });
  const report = vi.fn(() => {
    throw new Error('logger unavailable');
  });
  const projection = new PiEventProjection([observe], controller.signal, report);
  expect(() => projection.push({ type: PiAgentEventType.MessageEnd })).not.toThrow();
  controller.abort();
  projection.push({ type: PiAgentEventType.AgentSettled });
  expect(observe).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledTimes(1);
});

test('deltas after a slow tool path are not delayed by a pending transform', async () => {
  vi.useFakeTimers();
  const consumed: string[] = [];
  const controller = new AbortController();
  const queue = new PiEventProjection<{ type: string; result?: unknown }>(
    [event => consumed.push(event.type)],
    controller.signal,
    vi.fn(),
  );
  const startedAt = Date.now();
  queue.push({ type: PiRunEvent.ToolEnd, result: { content: [{ text: 'tool output' }] } });
  queue.push({ type: PiRunEvent.MessageUpdate });
  queue.push({ type: PiRunEvent.AgentEnd });
  expect(Date.now() - startedAt).toBeLessThan(50);
  expect(consumed).toEqual([PiRunEvent.ToolEnd, PiRunEvent.MessageUpdate, PiRunEvent.AgentEnd]);
  vi.useRealTimers();
});
