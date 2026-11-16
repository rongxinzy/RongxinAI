import { describe, expect, test } from 'vitest';

import { CoworkPermissionOrigin } from '../../../../shared/cowork/constants';
import { CoworkToolActivityPhase } from '../../../../shared/cowork/toolActivity';
import type { CoworkMessage, CoworkPermissionRequest } from '../../../types/cowork';
import { projectSessionToTurns } from './projectTurns';

const makeMsg = (
  partial: Partial<CoworkMessage> & Pick<CoworkMessage, 'id' | 'type'>,
): CoworkMessage => ({
  content: '',
  timestamp: 1000,
  ...partial,
});

describe('projectSessionToTurns', () => {
  test('groups consecutive read-only tool calls into a single tool_group', () => {
    const messages: CoworkMessage[] = [
      makeMsg({ id: 'u1', type: 'user', content: 'Inspect repo' }),
      makeMsg({
        id: 't1',
        type: 'tool_use',
        metadata: { toolName: 'read', toolUseId: 'c1', toolInput: { path: 'a.ts' } },
      }),
      makeMsg({ id: 'r1', type: 'tool_result', content: 'code a', metadata: { toolUseId: 'c1' } }),
      makeMsg({
        id: 't2',
        type: 'tool_use',
        metadata: { toolName: 'grep', toolUseId: 'c2', toolInput: { pattern: 'foo' } },
      }),
      makeMsg({ id: 'r2', type: 'tool_result', content: 'match b', metadata: { toolUseId: 'c2' } }),
      makeMsg({
        id: 't3',
        type: 'tool_use',
        metadata: { toolName: 'edit', toolUseId: 'c3', toolInput: { path: 'a.ts' } },
      }),
      makeMsg({ id: 'r3', type: 'tool_result', content: 'edited', metadata: { toolUseId: 'c3' } }),
      makeMsg({ id: 'a1', type: 'assistant', content: 'Done!', metadata: { isFinalAnswer: true } }),
    ];

    const { turns } = projectSessionToTurns({
      messages,
      toolActivities: [],
      artifacts: [],
      previewableTypes: new Set(['code']),
      isStreaming: false,
    });

    expect(turns).toHaveLength(1);
    const [turn] = turns;
    expect(turn.parts.map(p => p.kind)).toEqual(['tool_group', 'tool', 'text']);
    const group = turn.parts[0];
    if (group?.kind === 'tool_group') {
      expect(group.parts).toHaveLength(2);
      expect(group.parts.map(p => p.toolName)).toEqual(['read', 'grep']);
    }
    expect(turn.copyText).toBe('Done!');
  });

  test('binds pending permission directly to the matching open tool part', () => {
    const messages: CoworkMessage[] = [
      makeMsg({ id: 'u1', type: 'user', content: 'Run build' }),
      makeMsg({
        id: 't1',
        type: 'tool_use',
        metadata: {
          toolName: 'bash',
          toolUseId: 'call-bash-1',
          toolInput: { command: 'bun run build' },
        },
      }),
    ];
    const permission: CoworkPermissionRequest = {
      requestId: 'req-1',
      sessionId: 's1',
      toolName: 'bash',
      toolUseId: 'call-bash-1',
      toolInput: { command: 'bun run build' },
      origin: CoworkPermissionOrigin.PiWorkbench,
    };

    const { turns, unmatchedPermission } = projectSessionToTurns({
      messages,
      toolActivities: [],
      pendingPermission: permission,
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: true,
    });

    expect(unmatchedPermission).toBeNull();
    const part = turns[0]?.parts[0];
    expect(part?.kind).toBe('tool');
    if (part?.kind === 'tool') {
      expect(part.phase).toBe('approval-requested');
      expect(part.pendingPermission?.requestId).toBe('req-1');
    }
    expect(turns[0]?.hasApproval).toBe(true);
  });

  test('surfaces in-flight streaming tool activities seamlessly before tool_use arrives', () => {
    const { turns } = projectSessionToTurns({
      messages: [makeMsg({ id: 'u1', type: 'user', content: 'Hello' })],
      toolActivities: [
        {
          toolCallId: 'live-1',
          toolName: 'bash',
          toolInput: { command: 'ls -la' },
          phase: CoworkToolActivityPhase.Preparing,
          updatedAt: 1001,
        },
      ],
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: true,
    });

    expect(turns).toHaveLength(1);
    const part = turns[0]?.parts[0];
    expect(part?.kind).toBe('tool');
    if (part?.kind === 'tool') {
      expect(part.phase).toBe('input-streaming');
      expect(part.toolName).toBe('bash');
    }
  });
});
