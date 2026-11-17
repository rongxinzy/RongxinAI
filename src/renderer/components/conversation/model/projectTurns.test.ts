import { describe, expect, test } from 'vitest';

import { CoworkPermissionOrigin } from '../../../../shared/cowork/constants';
import { CoworkToolActivityPhase } from '../../../../shared/cowork/toolActivity';
import type { CoworkMessage, CoworkPermissionRequest } from '../../../types/cowork';
import {
  createSessionTurnsSelector,
  groupContiguousActivityParts,
  groupPartByType,
  projectSessionToTurns,
} from './projectTurns';

const makeMsg = (
  partial: Partial<CoworkMessage> & Pick<CoworkMessage, 'id' | 'type'>,
): CoworkMessage => ({
  content: '',
  timestamp: 1000,
  ...partial,
});

describe('projectSessionToTurns', () => {
  test('groups contiguous reasoning and tool calls into a single tool_group and breaks on text', () => {
    const messages: CoworkMessage[] = [
      makeMsg({ id: 'u1', type: 'user', content: 'Inspect repo' }),
      makeMsg({
        id: 'th1',
        type: 'assistant',
        content: 'Let me inspect the files first',
        metadata: { isThinking: true },
      }),
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
    expect(turn.parts.map(p => p.kind)).toEqual(['tool_group', 'text']);
    const group = turn.parts[0];
    if (group?.kind === 'tool_group') {
      expect(group.parts).toHaveLength(4);
      expect(group.parts.map(p => (p.kind === 'reasoning' ? 'reasoning' : p.toolName))).toEqual([
        'reasoning',
        'read',
        'grep',
        'edit',
      ]);
      expect(group.hasError).toBe(false);
      expect(group.hasApproval).toBe(false);
    }
    expect(turn.copyText).toBe('Done!');
  });

  test('keeps single isolated reasoning or tool parts flat without wrapping in a group', () => {
    const messages: CoworkMessage[] = [
      makeMsg({ id: 'u1', type: 'user', content: 'Check once' }),
      makeMsg({
        id: 'th1',
        type: 'assistant',
        content: 'Thinking',
        metadata: { isThinking: true },
      }),
      makeMsg({ id: 'a1', type: 'assistant', content: 'Interim note' }),
      makeMsg({
        id: 't1',
        type: 'tool_use',
        metadata: { toolName: 'read', toolUseId: 'c1', toolInput: { path: 'a.ts' } },
      }),
      makeMsg({ id: 'r1', type: 'tool_result', content: 'ok', metadata: { toolUseId: 'c1' } }),
      makeMsg({ id: 'a2', type: 'assistant', content: 'Final answer' }),
    ];

    const { turns } = projectSessionToTurns({
      messages,
      toolActivities: [],
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: false,
    });

    expect(turns[0]?.parts.map(p => p.kind)).toEqual(['reasoning', 'text', 'tool', 'text']);
  });

  test('propagates hasError and hasApproval onto grouped parts and turns', () => {
    const messages: CoworkMessage[] = [
      makeMsg({ id: 'u1', type: 'user', content: 'Run commands' }),
      makeMsg({
        id: 'th1',
        type: 'assistant',
        content: 'Planning',
        metadata: { isThinking: true },
      }),
      makeMsg({
        id: 't1',
        type: 'tool_use',
        metadata: { toolName: 'bash', toolUseId: 'c1', toolInput: { command: 'npm test' } },
      }),
      makeMsg({
        id: 'r1',
        type: 'tool_result',
        content: 'exit 1',
        metadata: { toolUseId: 'c1', isError: true },
      }),
    ];

    const { turns } = projectSessionToTurns({
      messages,
      toolActivities: [],
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: false,
    });

    expect(turns[0]?.hasError).toBe(true);
    const group = turns[0]?.parts[0];
    expect(group?.kind).toBe('tool_group');
    if (group?.kind === 'tool_group') {
      expect(group.hasError).toBe(true);
      expect(group.hasApproval).toBe(false);
    }

    const custom = groupContiguousActivityParts(
      [
        {
          kind: 'reasoning',
          id: 'reasoning:1',
          message: makeMsg({ id: 'th1', type: 'assistant', content: 'x' }),
          isStreaming: false,
          isComplete: true,
        },
        {
          kind: 'tool',
          id: 'tool:1',
          toolCallId: '1',
          toolName: 'read',
          category: 'file-read',
          readOnly: true,
          phase: 'output-available',
          isError: false,
        },
        {
          kind: 'tool',
          id: 'tool:2',
          toolCallId: '2',
          toolName: 'bash',
          category: 'shell',
          readOnly: false,
          phase: 'output-available',
          isError: false,
        },
      ],
      groupPartByType({ tool: ['group-tool'] }),
    );
    expect(custom.map(p => p.kind)).toEqual(['reasoning', 'tool_group']);
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

  test('updates argsChars progress on active input-streaming tool activities', () => {
    const { turns } = projectSessionToTurns({
      messages: [makeMsg({ id: 'u1', type: 'user', content: 'Write file' })],
      toolActivities: [
        {
          toolCallId: 'write-1',
          toolName: 'write',
          toolInput: { file_path: 'src/index.ts' },
          phase: CoworkToolActivityPhase.Preparing,
          progress: { argsChars: 240 },
          updatedAt: 1001,
        },
        {
          toolCallId: 'write-1',
          toolName: 'write',
          toolInput: { file_path: 'src/index.ts' },
          phase: CoworkToolActivityPhase.Preparing,
          progress: { argsChars: 1480 },
          updatedAt: 1002,
        },
      ],
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: true,
    });

    const part = turns[0]?.parts[0];
    expect(part?.kind).toBe('tool');
    if (part?.kind === 'tool') {
      expect(part.phase).toBe('input-streaming');
      expect(part.progress?.argsChars).toBe(1480);
    }
  });

  test('projects both ledger-recorded and explicit inline deliverables onto their turn', () => {
    const messages: CoworkMessage[] = [
      makeMsg({ id: 'u1', type: 'user', content: 'Generate report' }),
      makeMsg({
        id: 't1',
        type: 'tool_use',
        metadata: { toolName: 'write', toolUseId: 'c1', toolInput: { path: 'report.html' } },
      }),
      makeMsg({ id: 'r1', type: 'tool_result', content: 'ok', metadata: { toolUseId: 'c1' } }),
      makeMsg({
        id: 'a1',
        type: 'assistant',
        content: 'Done!',
        metadata: { isFinalAnswer: true },
      }),
    ];

    const { turns } = projectSessionToTurns({
      messages,
      toolActivities: [],
      artifacts: [
        {
          id: 'artifact-tool-r1',
          messageId: 'r1',
          sessionId: 's1',
          toolCallId: 'c1',
          type: 'html',
          title: 'report.html',
          content: '<h1>Hi</h1>',
          fileName: 'report.html',
          filePath: '/work/report.html',
          source: 'tool',
          role: 'deliverable',
          declared: true,
          createdAt: 1000,
        },
        {
          id: 'artifact-a1-0',
          messageId: 'a1',
          sessionId: 's1',
          type: 'mermaid',
          title: 'Flow',
          content: 'graph TD; A-->B;',
          source: 'codeblock',
          role: 'deliverable',
          declared: true,
          createdAt: 1001,
        },
        {
          id: 'artifact-helper',
          messageId: 'r1',
          sessionId: 's1',
          toolCallId: 'c1',
          type: 'code',
          title: 'helper.py',
          content: 'print(1)',
          fileName: 'helper.py',
          filePath: '/work/helper.py',
          source: 'tool',
          role: 'intermediate',
          declared: false,
          createdAt: 1002,
        },
      ],
      previewableTypes: new Set(['html', 'mermaid', 'code']),
      isStreaming: false,
    });

    expect(turns[0]?.deliverables.map(item => item.id)).toEqual([
      'artifact-tool-r1',
      'artifact-a1-0',
    ]);
  });

  test('matches cross-turn tool results caused by mid-run steering without stranding open tools', () => {
    const messages: CoworkMessage[] = [
      makeMsg({ id: 'u1', type: 'user', content: 'Analyze file' }),
      makeMsg({
        id: 't1',
        type: 'tool_use',
        metadata: { toolName: 'bash', toolUseId: 'c1', toolInput: { command: 'sleep 1' } },
      }),
      makeMsg({ id: 'u2', type: 'user', content: 'Also check tests' }),
      makeMsg({
        id: 'r1',
        type: 'tool_result',
        content: 'exit 0',
        metadata: { toolUseId: 'c1', toolResult: 'exit 0' },
      }),
      makeMsg({
        id: 'a2',
        type: 'assistant',
        content: 'Both done!',
        metadata: { isFinalAnswer: true },
      }),
    ];

    const { turns } = projectSessionToTurns({
      messages,
      toolActivities: [],
      artifacts: [],
      previewableTypes: new Set(),
      isStreaming: false,
    });

    expect(turns).toHaveLength(2);
    expect(turns[0]?.parts).toHaveLength(1);
    const matchedTool = turns[0]?.parts[0];
    expect(matchedTool?.kind).toBe('tool');
    if (matchedTool?.kind === 'tool') {
      expect(matchedTool.phase).toBe('output-available');
      expect(matchedTool.output).toBe('exit 0');
    }
    expect(turns[1]?.parts.map(p => p.kind)).toEqual(['text']);
  });

  test('keeps historical turn references stable when toolActivities or tail streaming change', () => {
    const selector = createSessionTurnsSelector();
    const baseHistory: CoworkMessage[] = [
      makeMsg({ id: 'u1', type: 'user', content: 'Turn 1' }),
      makeMsg({
        id: 'a1',
        type: 'assistant',
        content: 'Reply 1',
        metadata: { isFinalAnswer: true },
      }),
      makeMsg({ id: 'u2', type: 'user', content: 'Turn 2' }),
    ];
    const first = selector({
      messages: baseHistory,
      toolActivities: [],
      artifacts: [],
      previewableTypes: new Set(['html']),
      isStreaming: true,
    });

    const second = selector({
      messages: baseHistory,
      toolActivities: [
        {
          toolCallId: 'c-tail',
          toolName: 'write',
          phase: CoworkToolActivityPhase.Preparing,
          progress: { argsChars: 240 },
          updatedAt: 2000,
        },
      ],
      artifacts: [],
      previewableTypes: new Set(['html']),
      isStreaming: true,
    });

    expect(second.turns[0]).toBe(first.turns[0]);
    expect(second.turns[0].parts).toBe(first.turns[0].parts);
    expect(second.turns[1]).not.toBe(first.turns[1]);

    const third = selector({
      messages: [...baseHistory, makeMsg({ id: 'a2', type: 'assistant', content: 'Streaming...' })],
      toolActivities: [],
      artifacts: [],
      previewableTypes: new Set(['html']),
      isStreaming: true,
    });
    expect(third.turns[0]).toBe(first.turns[0]);
  });
});
