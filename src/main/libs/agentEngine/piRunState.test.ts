import { afterEach, expect, test, vi } from 'vitest';
import {
  CoworkRunPhase,
  CoworkRunPolicy,
  PiRunEvent,
  type CoworkRunSnapshot,
} from '../../../shared/cowork/runState';
import { getToolProgressPreview, PiRunStateTracker } from './piRunState';

afterEach(() => vi.useRealTimers());

test('projects pre-run compaction and preserves its identity and elapsed time when generation starts', () => {
  vi.useFakeTimers();
  const tracker = new PiRunStateTracker(() => {});
  tracker.observe('a', { type: PiRunEvent.CompactStart });
  const compacting = tracker.snapshot('a')!;
  expect(compacting).toMatchObject({ phase: CoworkRunPhase.Compacting, running: true });
  vi.advanceTimersByTime(40_000);
  tracker.observe('a', { type: PiRunEvent.CompactEnd });
  expect(tracker.snapshot('a')?.phase).toBe(CoworkRunPhase.Waiting);
  tracker.observe('a', { type: PiRunEvent.AgentStart });
  expect(tracker.snapshot('a')).toMatchObject({
    runId: compacting.runId,
    startedAt: compacting.startedAt,
    running: true,
  });
  tracker.finish('a', CoworkRunPhase.Stopped);
  expect(tracker.snapshot('a')?.running).toBe(false);
});
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
test('keeps the Workbench run identity and ordering through a Pi restart', () => {
  vi.useFakeTimers();
  const tracker = new PiRunStateTracker(() => {});
  const start = { type: PiRunEvent.AgentStart };
  tracker.observe('a', start, 'workbench-one');
  const started = tracker.snapshot('a')!;
  tracker.finish('a', CoworkRunPhase.Error);
  const ended = tracker.snapshot('a')!;
  tracker.observe('a', start, 'workbench-one');
  const restarted = tracker.snapshot('a')!;
  expect(restarted).toMatchObject({
    runId: 'workbench-one',
    running: true,
    startedAt: started.startedAt,
  });
  expect(restarted.sequence).toBeGreaterThan(ended.sequence);
  tracker.observe('a', start, 'workbench-two');
  const next = tracker.snapshot('a')!;
  expect(next.runId).toBe('workbench-two');
  expect(next.startedAt).toBeGreaterThan(restarted.startedAt);
});
test('does not serialize arbitrary or cyclic tool objects', () => {
  const value: Record<string, unknown> = {};
  value.self = value;
  expect(getToolProgressPreview(value)).toBe('');
});
test('keeps the run alive while tool arguments stream in', () => {
  vi.useFakeTimers();
  const tracker = new PiRunStateTracker(() => {});
  tracker.observe('a', { type: PiRunEvent.AgentStart });
  const before = tracker.snapshot('a')!;
  vi.advanceTimersByTime(1_000);
  tracker.observe('a', {
    type: PiRunEvent.MessageUpdate,
    assistantMessageEvent: {
      type: PiRunEvent.ToolCallDelta,
      contentIndex: 0,
      partial: {
        content: [
          {
            type: 'toolCall',
            id: 'write-1',
            name: 'Write',
            arguments: { path: 'report.md' },
            partialJson: '{"path":"report.md","content":"aa',
          },
        ],
      },
    },
  });
  const after = tracker.snapshot('a')!;
  expect(after.phase).toBe(CoworkRunPhase.Tool);
  expect(after.toolName).toBe('Write');
  expect(after.preview).toBe('Write report.md');
  expect(after.lastProgressAt).toBeGreaterThan(before.lastProgressAt);
});
