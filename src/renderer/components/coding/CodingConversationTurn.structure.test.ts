import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import { conversationTurnPropsEqual } from './CodingConversationTurn';
import { projectCodingEvents } from './codingEventProjection';
const turnSource = readFileSync(
  fileURLToPath(new URL('./CodingConversationTurn.tsx', import.meta.url)),
  'utf8',
);
const activitySource = readFileSync(
  fileURLToPath(new URL('./CodingActivityView.tsx', import.meta.url)),
  'utf8',
);

test('keeps permission tool cards collapsed until explicitly opened', () => {
  expect(turnSource).toContain('open={expandedActivityIds.has(activity.id)}');
  expect(turnSource).not.toContain(
    'activity.kind === CodingConversationActivityKind.Permission ||',
  );
  expect(activitySource).toContain('defaultOpen={false}');
  expect(activitySource).not.toContain(
    'defaultOpen={activity.kind === CodingConversationActivityKind.Permission}',
  );
});

test('shows completed duration when a turn has no reasoning or tool segments', () => {
  expect(turnSource).toContain('{!hasReasoningGroup && turn.completedAt !== null ? (');
  expect(turnSource).toContain('const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));');
  expect(turnSource).toContain('const seconds = totalSeconds % 60;');
  expect(turnSource).toContain('const minutes = totalMinutes % 60;');
});

test('does not mount the approval card inside the process group', () => {
  expect(activitySource).not.toContain('CodingPermissionCard');
  expect(turnSource).not.toContain('pendingPermissionId');
});

test('shows timestamps for coding user and assistant messages', () => {
  expect(turnSource).toContain('const CodingUserMessage = ({');
  expect(turnSource).toContain('<CopyButton content={content} visible />');
  expect(turnSource).toContain('<ReEditButton visible onClick={onReEdit} />');
  expect(turnSource).toContain('const CodingAssistantMessage = ({');
  expect(turnSource).toContain('formatMessageDateTime(createdAt)');
});

test('does not use JSON.stringify for turn equality checks', () => {
  expect(turnSource).not.toContain('JSON.stringify(activity.event.payload)');
  expect(turnSource).not.toContain('JSON.stringify(a.activity.event.payload)');
  expect(turnSource).toContain('activityPayloadEqual');
});

test('re-renders completed turn when tool event payload is updated post-completion', () => {
  const baseEvents: CodingEvent[] = [
    {
      id: 'event-1',
      laneId: 'lane-1',
      sequence: 1,
      kind: CodingEventKind.Message,
      payload: { role: 'user', content: 'run tool' },
      createdAt: 1,
    },
    {
      id: 'event-2',
      laneId: 'lane-1',
      sequence: 2,
      kind: CodingEventKind.ToolCall,
      payload: { toolCallId: 'call-1', toolName: 'bash', status: 'pending' },
      createdAt: 2,
    },
    {
      id: 'event-3',
      laneId: 'lane-1',
      sequence: 3,
      kind: CodingEventKind.TurnComplete,
      payload: {},
      createdAt: 3,
    },
  ];

  const [turnInitial] = projectCodingEvents(baseEvents);
  expect(turnInitial.status).toBe('complete');
  expect(turnInitial.activities[0].event.payload.status).toBe('pending');

  // Simulate backend merging tool execution results into the same event (same id/seq)
  const updatedEvents: CodingEvent[] = [
    baseEvents[0],
    {
      ...baseEvents[1],
      payload: {
        toolCallId: 'call-1',
        toolName: 'bash',
        status: 'completed',
        output: 'command output',
      },
    },
    baseEvents[2],
  ];

  const [turnUpdated] = projectCodingEvents(updatedEvents);
  expect(turnUpdated.status).toBe('complete');
  expect(turnUpdated.activities[0].event.payload.status).toBe('completed');

  // Mock props comparing turnInitial and turnUpdated
  const dummyProps = {
    isStreaming: false,
    showWaitingIndicator: false,
    artifactsByMessageId: new Map(),
    artifactsByToolCallId: new Map(),
    expandedActivityIds: new Set<string>(),
    onActivityOpenChange: () => {},
    onReEditUserMessage: () => {},
    cwd: '/test',
  };

  // Must detect difference and NOT consider props equal (must re-render)
  const isEqual = conversationTurnPropsEqual(
    { ...dummyProps, turn: turnInitial },
    { ...dummyProps, turn: turnUpdated },
  );
  expect(isEqual).toBe(false);

  // But if nothing changed in events, re-projected turn should be considered equal
  const [turnRecreated] = projectCodingEvents(baseEvents);
  const isEqualUnchanged = conversationTurnPropsEqual(
    { ...dummyProps, turn: turnInitial },
    { ...dummyProps, turn: turnRecreated },
  );
  expect(isEqualUnchanged).toBe(true);
});
