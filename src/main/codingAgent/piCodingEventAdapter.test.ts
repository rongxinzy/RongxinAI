import { describe, expect, test } from 'vitest';

import {
  CodingEventKind,
  CodingStreamUpdateMode,
  CodingToolCallStatus,
} from '../../shared/codingAgent';
import {
  CoworkToolActivityEventType,
  CoworkToolActivityPhase,
} from '../../shared/cowork/toolActivity';
import { normalizePiMessage, normalizePiToolActivity } from './piCodingEventAdapter';

describe('Pi coding event adapter', () => {
  test('maps tool messages to durable tool call events', () => {
    expect(
      normalizePiMessage({
        id: 'message-1',
        type: 'tool_use',
        content: 'Using tool: bash',
        metadata: {
          toolUseId: 'call-1',
          toolName: 'bash',
          toolInput: { command: 'pwd' },
        },
      }),
    ).toEqual({
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId: 'call-1',
        toolName: 'bash',
        toolInput: { command: 'pwd' },
        status: CodingToolCallStatus.Pending,
      },
    });

    expect(
      normalizePiMessage({
        id: 'message-2',
        type: 'tool_result',
        content: 'done',
        metadata: { toolUseId: 'call-1', toolResult: 'done' },
      }),
    ).toEqual({
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId: 'call-1',
        output: 'done',
        status: CodingToolCallStatus.Completed,
      },
    });
  });

  test('flattens transient tool activity updates', () => {
    expect(
      normalizePiToolActivity({
        type: CoworkToolActivityEventType.Upsert,
        activity: {
          toolCallId: 'call-1',
          toolName: 'bash',
          toolInput: { command: 'pwd' },
          phase: CoworkToolActivityPhase.Preparing,
          updatedAt: 1,
        },
      }),
    ).toMatchObject({
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId: 'call-1',
        toolName: 'bash',
        status: CodingToolCallStatus.Pending,
        streamUpdateMode: CodingStreamUpdateMode.Replace,
      },
    });
    expect(
      normalizePiToolActivity({
        type: CoworkToolActivityEventType.Remove,
        toolCallId: 'call-1',
      }),
    ).toMatchObject({
      kind: CodingEventKind.ToolCall,
      payload: { toolCallId: 'call-1', status: CodingToolCallStatus.Completed },
    });
    expect(normalizePiToolActivity({ type: CoworkToolActivityEventType.Clear })).toBeNull();
  });
});
