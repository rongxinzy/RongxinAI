import { describe, expect, test, vi } from 'vitest';

import {
  CodingEventKind,
  CodingStreamUpdateMode,
  CodingToolCallStatus,
} from '../../shared/codingAgent';
import {
  CoworkToolActivityEventType,
  CoworkToolActivityPhase,
} from '../../shared/cowork/toolActivity';
import { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import {
  bindCodingRoomPiEvents,
  normalizePiMessage,
  normalizePiToolActivity,
} from './piCodingEventAdapter';

describe('Pi coding event adapter', () => {
  test('tracks only the bound lane and releases its Pi subscriptions at disposal', () => {
    const runtime = new PiRuntimeAdapter();
    const lane = 'coding-lane';
    const other = 'cowork-session';
    const room = {
      isBuiltinLaneSession: (id: string) => id === lane,
      recordBuiltinEvent: vi.fn(),
      recordBuiltinElicitation: vi.fn(),
      recordBuiltinInterruption: vi.fn(),
    };
    const detach = bindCodingRoomPiEvents(runtime, room);
    expect(runtime.hasStreamingTextSubscribers(lane)).toBe(true);
    expect(runtime.hasStreamingTextSubscribers(other)).toBe(false);
    runtime.emit('messageUpdate', other, 'text-id', 'A Cowork update');
    runtime.emit('messageUpdate', lane, 'text-id', 'A lane update');
    runtime.emit('complete', lane);
    expect(room.recordBuiltinEvent.mock.calls).toEqual([
      [
        lane,
        CodingEventKind.MessageDelta,
        {
          messageId: 'text-id',
          content: 'A lane update',
          streamUpdateMode: CodingStreamUpdateMode.Replace,
        },
      ],
      [lane, CodingEventKind.TurnComplete, {}],
    ]);
    detach();
    expect(runtime.hasStreamingTextSubscribers(lane)).toBe(false);
    expect(runtime.eventNames()).toEqual([]);
    runtime.emit('complete', lane);
    expect(room.recordBuiltinEvent).toHaveBeenCalledTimes(2);
  });

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
