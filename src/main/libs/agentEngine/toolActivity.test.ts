import { expect, test } from 'vitest';

import {
  CoworkToolActivityEventType,
  CoworkToolActivityPhase,
} from '../../../shared/cowork/toolActivity';
import {
  extractAgentPreparingToolActivities,
  getPiPreparingToolActivity,
  ToolActivityTracker,
  toToolActivityInput,
} from './toolActivity';

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
