import { afterEach, expect, test, vi } from 'vitest';

import {
  CoworkToolActivityEventType,
  CoworkToolActivityPhase,
} from '../../../shared/cowork/toolActivity';
import {
  extractAgentPreparingToolActivities,
  getPiPreparingToolActivity,
  TOOL_ACTIVITY_PROGRESS_CHARS_THRESHOLD,
  TOOL_ACTIVITY_PROGRESS_INTERVAL_MS,
  ToolActivityTracker,
  toToolActivityInput,
} from './toolActivity';

afterEach(() => vi.useRealTimers());

test('extracts Pi tool calls from partial argument snapshots', () => {
  const activity = getPiPreparingToolActivity(
    {
      type: 'toolcall_delta',
      contentIndex: 1,
      partial: {
        content: [
          { type: 'text', text: 'working' },
          {
            type: 'toolCall',
            id: 'write-1',
            name: 'Write',
            arguments: { path: 'src/app.ts', content: 'a'.repeat(10_000) },
          },
        ],
      },
    },
    'fallback-1',
  );

  expect(activity).toEqual({
    toolCallId: 'write-1',
    toolName: 'Write',
    toolInput: { path: 'src/app.ts' },
  });
});

test('extracts nested runtime tool call blocks without tool results', () => {
  const activities = extractAgentPreparingToolActivities({
    stream: 'assistant',
    data: {
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Updating the file' },
          {
            type: 'toolCall',
            id: 'edit-1',
            name: 'Edit',
            arguments: { file_path: 'src/app.ts', old_string: 'a', new_string: 'b' },
          },
          { type: 'toolResult', toolCallId: 'edit-1', content: 'done' },
        ],
      },
    },
  });

  expect(activities).toEqual([
    {
      toolCallId: 'edit-1',
      toolName: 'Edit',
      toolInput: { file_path: 'src/app.ts' },
    },
  ]);
});

test('projects only bounded fields needed by execution summaries', () => {
  expect(
    toToolActivityInput({
      command: 'x'.repeat(500),
      content: 'private file contents',
      arbitrary: { nested: true },
    }),
  ).toEqual({ command: `${'x'.repeat(237)}...` });
});

test('deduplicates unchanged deltas and isolates parallel calls', () => {
  const tracker = new ToolActivityTracker();
  const first = tracker.upsert({ toolCallId: 'call-1', toolName: 'Read' });
  const duplicate = tracker.upsert({ toolCallId: 'call-1', toolName: 'Read' });
  const parallel = tracker.upsert(
    { toolCallId: 'call-2', toolName: 'Write' },
    CoworkToolActivityPhase.Running,
  );

  expect(first?.type).toBe(CoworkToolActivityEventType.Upsert);
  expect(duplicate).toBeNull();
  expect(parallel).toMatchObject({
    type: CoworkToolActivityEventType.Upsert,
    activity: { toolCallId: 'call-2', phase: CoworkToolActivityPhase.Running },
  });
  expect(tracker.remove('call-1')).toEqual({
    type: CoworkToolActivityEventType.Remove,
    toolCallId: 'call-1',
  });
  expect(tracker.clear()).toEqual({ type: CoworkToolActivityEventType.Clear });
  expect(tracker.clear()).toBeNull();
});

test('reports generated argument characters from partial snapshots', () => {
  const partialJson = '{"path":"report.md","content":"aaaa';
  const activity = getPiPreparingToolActivity(
    {
      type: 'toolcall_delta',
      contentIndex: 0,
      delta: 'aaaa',
      partial: {
        content: [
          {
            type: 'toolCall',
            id: 'write-1',
            name: 'Write',
            arguments: { path: 'report.md' },
            partialJson,
          },
        ],
      },
    },
    'fallback-1',
  );

  expect(activity?.progress).toEqual({ argsChars: partialJson.length });
  expect(activity?.progressDeltaChars).toBeUndefined();
});

test('falls back to per-delta character counts without a partial snapshot', () => {
  const activity = getPiPreparingToolActivity(
    {
      type: 'toolcall_delta',
      contentIndex: 0,
      delta: 'abcde',
      partial: {
        content: [{ type: 'toolCall', id: 'write-1', name: 'Write', arguments: {} }],
      },
    },
    'fallback-1',
  );

  expect(activity?.progress).toBeUndefined();
  expect(activity?.progressDeltaChars).toBe(5);
});

test('emits argument progress only past the size or time threshold', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const tracker = new ToolActivityTracker();
  const base = { toolCallId: 'call-1', toolName: 'Write', toolInput: { path: 'report.md' } };

  expect(tracker.upsert({ ...base, progress: { argsChars: 100 } })).toMatchObject({
    activity: { progress: { argsChars: 100 } },
  });

  // Below both thresholds: throttled.
  vi.setSystemTime(1_100);
  expect(tracker.upsert({ ...base, progress: { argsChars: 500 } })).toBeNull();

  // Character threshold reached.
  vi.setSystemTime(1_200);
  expect(
    tracker.upsert({
      ...base,
      progress: { argsChars: 100 + TOOL_ACTIVITY_PROGRESS_CHARS_THRESHOLD },
    }),
  ).toMatchObject({
    activity: { progress: { argsChars: 100 + TOOL_ACTIVITY_PROGRESS_CHARS_THRESHOLD } },
  });

  // Time threshold reached with a small increment.
  const afterChars = 100 + TOOL_ACTIVITY_PROGRESS_CHARS_THRESHOLD;
  vi.setSystemTime(1_200 + TOOL_ACTIVITY_PROGRESS_INTERVAL_MS);
  expect(tracker.upsert({ ...base, progress: { argsChars: afterChars + 10 } })).toMatchObject({
    activity: { progress: { argsChars: afterChars + 10 } },
  });
});

test('always emits phase changes regardless of progress throttling', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const tracker = new ToolActivityTracker();
  tracker.upsert({ toolCallId: 'call-1', toolName: 'Write', progress: { argsChars: 10 } });

  vi.setSystemTime(1_010);
  expect(
    tracker.upsert(
      { toolCallId: 'call-1', toolName: 'Write', progress: { argsChars: 20 } },
      CoworkToolActivityPhase.Running,
    ),
  ).toMatchObject({
    activity: { phase: CoworkToolActivityPhase.Running, progress: { argsChars: 20 } },
  });
});

test('tracks progress independently per tool call and carries the count forward', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const tracker = new ToolActivityTracker();
  tracker.upsert({ toolCallId: 'a', toolName: 'Write', progress: { argsChars: 100 } });
  tracker.upsert({ toolCallId: 'b', toolName: 'Write', progress: { argsChars: 100 } });

  // Small increments stay throttled on both calls independently.
  vi.setSystemTime(1_100);
  expect(
    tracker.upsert({ toolCallId: 'a', toolName: 'Write', progress: { argsChars: 200 } }),
  ).toBeNull();
  expect(
    tracker.upsert({ toolCallId: 'b', toolName: 'Write', progress: { argsChars: 200 } }),
  ).toBeNull();

  // toolcall_end carries no partial snapshot: the last known count is kept.
  expect(
    tracker.upsert({ toolCallId: 'a', toolName: 'Write', toolInput: { path: 'report.md' } }),
  ).toMatchObject({ activity: { progress: { argsChars: 200 } } });
});

test('accumulates per-delta character counts when snapshots are unavailable', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const tracker = new ToolActivityTracker();
  tracker.upsert({ toolCallId: 'call-1', toolName: 'Write', progressDeltaChars: 600 });

  vi.setSystemTime(1_000 + TOOL_ACTIVITY_PROGRESS_INTERVAL_MS);
  expect(
    tracker.upsert({ toolCallId: 'call-1', toolName: 'Write', progressDeltaChars: 600 }),
  ).toMatchObject({ activity: { progress: { argsChars: 1200 } } });
});
