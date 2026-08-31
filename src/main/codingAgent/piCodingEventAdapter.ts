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
