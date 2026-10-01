import { afterEach, expect, test, vi } from 'vitest';
import {
  CoworkRunPhase,
  CoworkRunPolicy,
  PiRunEvent,
  type CoworkRunSnapshot,
} from '../../../shared/cowork/runState';
import { getToolProgressPreview, PiRunStateTracker } from './piRunState';

afterEach(() => vi.useRealTimers());
test('confirms a silent running tool without inventing new progress', () => {
  vi.useFakeTimers();
  const tracker = new PiRunStateTracker(() => {});
  tracker.observe('a', { type: PiRunEvent.AgentStart });
  tracker.observe('a', { type: PiRunEvent.ToolStart, toolCallId: 'tool', toolName: 'bash' });
  const before = tracker.snapshot('a')!;
  vi.advanceTimersByTime(60_000);
  const after = tracker.snapshot('a')!;
  expect(after.running).toBe(true);
  expect(after.confirmedAt - before.confirmedAt).toBe(60_000);
  expect(after.lastProgressAt).toBe(before.lastProgressAt);
  expect(after.startedAt).toBe(before.startedAt);
});
test('publishes bounded intermediate output and preserves concurrent tool state', () => {
  vi.useFakeTimers();
  const published: CoworkRunSnapshot[] = [];
  const tracker = new PiRunStateTracker(snapshot => published.push(snapshot));
  tracker.observe('a', { type: PiRunEvent.AgentStart });
  for (const toolCallId of ['one', 'two'])
    tracker.observe('a', { type: PiRunEvent.ToolStart, toolCallId, toolName: toolCallId });
  tracker.observe('a', {
    type: PiRunEvent.ToolUpdate,
    toolCallId: 'one',
    partialResult: { content: [{ text: 'x'.repeat(10_000) + 'progress' }] },
  });
  vi.advanceTimersByTime(CoworkRunPolicy.EmitMs);
  expect(published.at(-1)?.preview).toHaveLength(CoworkRunPolicy.PreviewCharacters);
  expect(published.at(-1)?.preview?.endsWith('progress')).toBe(true);
  tracker.observe('a', { type: PiRunEvent.ToolEnd, toolCallId: 'one' });
  expect(tracker.snapshot('a')?.phase).toBe(CoworkRunPhase.Tool);
  expect(tracker.snapshot('a')?.toolName).toBe('two');
});
test('exposes retry and SDK compaction phases and rejects activity after termination', () => {
  const tracker = new PiRunStateTracker(() => {});
  tracker.observe('a', { type: PiRunEvent.AgentStart });
  tracker.observe('a', { type: PiRunEvent.RetryStart, attempt: 2, delayMs: 30_000 });
  expect(tracker.snapshot('a')).toMatchObject({ phase: CoworkRunPhase.Retry, retryAttempt: 2 });
  tracker.observe('a', { type: PiRunEvent.CompactStart });
  expect(tracker.snapshot('a')?.phase).toBe(CoworkRunPhase.Compacting);
  tracker.finish('a', CoworkRunPhase.Completed);
  tracker.observe('a', {
    type: PiRunEvent.MessageUpdate,
    assistantMessageEvent: { type: PiRunEvent.TextDelta },
  });
  expect(tracker.snapshot('a')).toMatchObject({ phase: CoworkRunPhase.Completed, running: false });
});
test('assigns a new run identity on continuation even within one millisecond', () => {
  vi.useFakeTimers();
  const tracker = new PiRunStateTracker(() => {});
  tracker.observe('a', { type: PiRunEvent.AgentStart });
  const first = tracker.snapshot('a')!;
  tracker.finish('a', CoworkRunPhase.Completed);
  tracker.observe('a', { type: PiRunEvent.AgentStart });
  const second = tracker.snapshot('a')!;
  expect(second.runId).not.toBe(first.runId);
  expect(second.startedAt).toBeGreaterThan(first.startedAt);
});
test('does not serialize arbitrary or cyclic tool objects', () => {
  const value: Record<string, unknown> = {};
  value.self = value;
  expect(getToolProgressPreview(value)).toBe('');
});
