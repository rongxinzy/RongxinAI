import {
  CodingEventKind,
  CodingStreamUpdateMode,
  CodingToolCallStatus,
  type CodingEvent,
} from '../../shared/codingAgent';
import {
  CoworkToolActivityEventType,
  type CoworkToolActivityEvent,
} from '../../shared/cowork/toolActivity';
import { CoworkInterruptionCause } from '../../shared/cowork/interruption';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import type { PiRuntimeEvents } from '../libs/agentEngine/piRuntimeTypes';
import type { CodingRoomService } from './codingRoomService';

type CodingDriverEvent = Omit<CodingEvent, 'id' | 'laneId' | 'sequence' | 'createdAt'>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** Converts Pi's Cowork messages into the payload contract used by coding lanes. */
export const normalizePiMessage = (value: unknown): CodingDriverEvent | null => {
  const message = asRecord(value);
  if (!message) return null;
  const type = message.type;
  const metadata = asRecord(message.metadata);
  if (type === 'assistant' || type === 'user') {
    return {
      kind: CodingEventKind.Message,
      payload: { message, role: type },
    };
  }
  if (type === 'tool_use') {
    const toolCallId =
      (typeof metadata?.toolUseId === 'string' && metadata.toolUseId) ||
      (typeof message.id === 'string' && message.id) ||
      null;
    if (!toolCallId) return null;
    return {
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId,
        toolName: typeof metadata?.toolName === 'string' ? metadata.toolName : message.content,
        toolInput: metadata?.toolInput,
        status: CodingToolCallStatus.Pending,
      },
    };
  }
  if (type === 'tool_result') {
    const toolCallId =
      (typeof metadata?.toolUseId === 'string' && metadata.toolUseId) ||
      (typeof message.id === 'string' && message.id) ||
      null;
    if (!toolCallId) return null;
    const failed = metadata?.isError === true || message.isError === true;
    return {
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId,
        output: typeof metadata?.toolResult === 'string' ? metadata.toolResult : message.content,
        status: failed ? CodingToolCallStatus.Failed : CodingToolCallStatus.Completed,
      },
    };
  }
  return null;
};

/** Flattens Pi's transient tool activity envelope into a durable coding event. */
export const normalizePiToolActivity = (
  event: CoworkToolActivityEvent,
): CodingDriverEvent | null => {
  if (event.type === CoworkToolActivityEventType.Upsert) {
    return {
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId: event.activity.toolCallId,
        toolName: event.activity.toolName,
        toolInput: event.activity.toolInput,
        phase: event.activity.phase,
        status: CodingToolCallStatus.Pending,
        streamUpdateMode: CodingStreamUpdateMode.Replace,
      },
    };
  }
  if (event.type === CoworkToolActivityEventType.Remove) {
    return {
      kind: CodingEventKind.ToolCall,
      payload: {
        toolCallId: event.toolCallId,
        status: CodingToolCallStatus.Completed,
        streamUpdateMode: CodingStreamUpdateMode.Replace,
      },
    };
  }
  return null;
};

export function bindCodingRoomPiEvents(
  runtime: Pick<PiRuntimeAdapter, 'on' | 'off' | 'registerStreamingTextInterestResolver'>,
  room: Pick<
    CodingRoomService,
    | 'isBuiltinLaneSession'
    | 'recordBuiltinEvent'
    | 'recordBuiltinElicitation'
    | 'recordBuiltinInterruption'
  >,
): () => void {
  // Only built-in lanes need full-text updates on Pi's in-process bus.
  const unsubscribe = [runtime.registerStreamingTextInterestResolver(room.isBuiltinLaneSession)];
  function bind<Event extends keyof PiRuntimeEvents>(
    event: Event,
    handler: PiRuntimeEvents[Event],
  ) {
    runtime.on(event, handler);
    unsubscribe.push(() => runtime.off(event, handler));
  }

  bind('message', (sessionId, message) => {
    if (!room.isBuiltinLaneSession(sessionId)) return;
    if (asRecord(asRecord(message)?.metadata)?.isThinking === true) {
      room.recordBuiltinEvent(sessionId, CodingEventKind.Reasoning, {
        message,
        streamUpdateMode: CodingStreamUpdateMode.Replace,
      });
      return;
    }
    const normalized = normalizePiMessage(message);
    if (normalized) room.recordBuiltinEvent(sessionId, normalized.kind, normalized.payload);
  });
  bind('messageUpdate', (sessionId, messageId, content, metadata) => {
    if (!room.isBuiltinLaneSession(sessionId)) return;
    room.recordBuiltinEvent(
      sessionId,
      metadata?.isThinking === true ? CodingEventKind.Reasoning : CodingEventKind.MessageDelta,
      { content, messageId, streamUpdateMode: CodingStreamUpdateMode.Replace },
    );
  });
  bind('toolActivity', (sessionId, event) => {
    if (!room.isBuiltinLaneSession(sessionId)) return;
    const normalized = normalizePiToolActivity(event);
    if (normalized) room.recordBuiltinEvent(sessionId, normalized.kind, normalized.payload);
  });
  bind('permissionRequest', (sessionId, request) => {
    const requestId = asRecord(request)?.requestId;
    room.recordBuiltinEvent(sessionId, CodingEventKind.Permission, {
      requestId: typeof requestId === 'string' ? requestId : null,
      request,
    });
  });
  bind('plan', (sessionId, plan) => {
    room.recordBuiltinEvent(sessionId, CodingEventKind.Plan, {
      entries: Array.isArray(plan?.entries) ? plan.entries : [],
    });
  });
  bind('codingElicitationRequest', (sessionId, request) => {
    room.recordBuiltinElicitation(sessionId, request);
  });
  bind('complete', sessionId => {
    room.recordBuiltinEvent(sessionId, CodingEventKind.TurnComplete, {});
  });
  bind('error', (sessionId, error) => {
    room.recordBuiltinEvent(sessionId, CodingEventKind.TurnFailed, { error });
  });
  bind('sessionInterrupted', interruption => {
    if (interruption.cause !== CoworkInterruptionCause.UserStop) {
      room.recordBuiltinInterruption(interruption);
    }
  });

  return () => unsubscribe.forEach(detach => detach());
}
