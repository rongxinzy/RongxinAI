import {
  CodingEventKind,
  CodingStreamUpdateMode,
  CodingToolCallStatus,
  type CodingEvent,
} from '../../../shared/codingAgent';
import { CoworkToolActivityEventType } from '../../../shared/cowork/toolActivity';
import {
  CodingConversationActivityKind,
  CodingConversationRole,
  CodingConversationTurnStatus,
  type CodingConversationActivityKind as CodingConversationActivityKindType,
  type CodingConversationRole as CodingConversationRoleType,
  type CodingConversationTurnStatus as CodingConversationTurnStatusType,
} from './constants';

export interface CodingConversationMessage {
  id: string;
  content: string;
  createdAt: number;
  role: CodingConversationRoleType;
}

export interface CodingConversationReasoning {
  id: string;
  content: string;
  createdAt: number;
}

export interface CodingConversationActivity {
  id: string;
  kind: CodingConversationActivityKindType;
  event: CodingEvent;
}

export interface CodingConversationTurn {
  id: string;
  userMessage: CodingConversationMessage | null;
  reasoning: CodingConversationReasoning | null;
  activities: CodingConversationActivity[];
  assistantMessages: CodingConversationMessage[];
  status: CodingConversationTurnStatusType | null;
  statusDetail: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readText = (value: unknown, depth = 0): string | null => {
  if (typeof value === 'string') return value;
  if (depth >= 3) return null;
  if (Array.isArray(value)) {
    const content = value
      .map(item => readText(item, depth + 1))
      .filter((item): item is string => item !== null)
      .join('');
    return content || null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ['content', 'text', 'message', 'output', 'error']) {
    const content = readText(record[key], depth + 1);
    if (content !== null) return content;
  }
  return null;
};

export const getCodingEventText = (event: CodingEvent): string =>
  readText(event.payload.content) ??
  readText(event.payload.message) ??
  readText(event.payload.text) ??
  readText(event.payload.output) ??
  readText(event.payload.error) ??
  '';

const getMessageRole = (event: CodingEvent): CodingConversationRoleType => {
  const nestedMessage = asRecord(event.payload.message);
  const role = event.payload.role ?? nestedMessage?.role ?? nestedMessage?.type;
  return role === CodingConversationRole.User
    ? CodingConversationRole.User
    : CodingConversationRole.Assistant;
};

const getMessageType = (event: CodingEvent): string | null => {
  const nestedMessage = asRecord(event.payload.message);
  const type = nestedMessage?.type;
  return typeof type === 'string' ? type : null;
};

const getMessageId = (event: CodingEvent): string => {
  if (typeof event.payload.messageId === 'string') return event.payload.messageId;
  const nestedMessage = asRecord(event.payload.message);
  return typeof nestedMessage?.id === 'string' ? nestedMessage.id : event.id;
};

const createTurn = (event: CodingEvent): CodingConversationTurn => ({
  id: event.id,
  userMessage: null,
  reasoning: null,
  activities: [],
  assistantMessages: [],
  status: null,
  statusDetail: null,
});

const appendAssistantMessage = (
  turn: CodingConversationTurn,
  event: CodingEvent,
  content: string,
): void => {
  const messageId = getMessageId(event);
  const existing = turn.assistantMessages.find(message => message.id === messageId);
  if (!existing) {
    turn.assistantMessages.push({
      id: messageId,
      content,
      createdAt: event.createdAt,
      role: CodingConversationRole.Assistant,
    });
    return;
  }
  existing.content =
    event.kind === CodingEventKind.Message ||
    event.payload.streamUpdateMode === CodingStreamUpdateMode.Replace
      ? content
      : `${existing.content}${content}`;
};

const activityKind = (event: CodingEvent): CodingConversationActivityKindType | null => {
  if (event.kind === CodingEventKind.Plan) return CodingConversationActivityKind.Plan;
  if (event.kind === CodingEventKind.ToolCall) return CodingConversationActivityKind.Tool;
  if (event.kind === CodingEventKind.Permission) return CodingConversationActivityKind.Permission;
  return null;
};

const getActivityId = (
  turn: CodingConversationTurn,
  event: CodingEvent,
  kind: CodingConversationActivityKindType,
): string => {
  const nestedEvent = asRecord(event.payload.event);
  const nestedActivity = asRecord(nestedEvent?.activity);
  for (const value of [
    event.payload.toolCallId,
    event.payload.tool_call_id,
    nestedActivity?.toolCallId,
    nestedEvent?.toolCallId,
    event.payload.permissionRequestId,
    event.payload.requestId,
    event.payload.planId,
  ]) {
    if (typeof value === 'string' && value) return `${kind}:${value}`;
  }
  return kind === CodingConversationActivityKind.Plan ? `${turn.id}:plan` : event.id;
};

const normalizeToolActivityEvent = (event: CodingEvent): CodingEvent => {
  if (event.kind !== CodingEventKind.ToolCall) return event;
  const nestedEvent = asRecord(event.payload.event);
  if (!nestedEvent) return event;
  const nestedActivity = asRecord(nestedEvent.activity);
  if (nestedEvent.type === CoworkToolActivityEventType.Upsert && nestedActivity) {
    return {
      ...event,
      payload: {
        ...nestedActivity,
        status: CodingToolCallStatus.Pending,
      },
    };
  }
  if (
    nestedEvent.type === CoworkToolActivityEventType.Remove &&
    typeof nestedEvent.toolCallId === 'string'
  ) {
    return {
      ...event,
      payload: {
        toolCallId: nestedEvent.toolCallId,
        status: CodingToolCallStatus.Completed,
      },
    };
  }
  return event;
};

export const projectCodingEvents = (events: CodingEvent[]): CodingConversationTurn[] => {
  const turns: CodingConversationTurn[] = [];
  let currentTurn: CodingConversationTurn | null = null;

  const ensureTurn = (event: CodingEvent): CodingConversationTurn => {
    if (currentTurn) return currentTurn;
    const turn = createTurn(event);
    turns.push(turn);
    currentTurn = turn;
    return turn;
  };

  for (const event of events.toSorted((left, right) => left.sequence - right.sequence)) {
    if (event.kind === CodingEventKind.Message || event.kind === CodingEventKind.MessageDelta) {
      if (event.kind === CodingEventKind.Message) {
        const messageType = getMessageType(event);
        if (messageType === 'tool_use' || messageType === 'tool_result') continue;
      }
      const content = getCodingEventText(event);
      if (!content) continue;
      const role = getMessageRole(event);
      if (role === CodingConversationRole.User) {
        if (
          currentTurn?.userMessage &&
          currentTurn.userMessage.content === content &&
          currentTurn.assistantMessages.length === 0 &&
          currentTurn.activities.length === 0 &&
          currentTurn.reasoning === null
        ) {
          continue;
        }
        const turn = createTurn(event);
        turn.userMessage = {
          id: getMessageId(event),
          content,
          createdAt: event.createdAt,
          role,
        };
        turns.push(turn);
        currentTurn = turn;
        continue;
      }
      appendAssistantMessage(ensureTurn(event), event, content);
      continue;
    }

    if (event.kind === CodingEventKind.Reasoning) {
      const content = getCodingEventText(event);
      if (!content) continue;
      const turn = ensureTurn(event);
      if (turn.reasoning && event.payload.streamUpdateMode === CodingStreamUpdateMode.Replace) {
        turn.reasoning.content = content;
      } else if (turn.reasoning) turn.reasoning.content += content;
      else turn.reasoning = { id: event.id, content, createdAt: event.createdAt };
      continue;
    }

    const projectedActivityKind = activityKind(event);
    if (projectedActivityKind) {
      const turn = ensureTurn(event);
      const id = getActivityId(turn, event, projectedActivityKind);
      const normalizedEvent = normalizeToolActivityEvent(event);
      const existing = turn.activities.find(
        activity => activity.id === id && activity.kind === projectedActivityKind,
      );
      if (existing) {
        // ACP tool_call_update only carries the fields that changed, so merge
        // it into the initial tool_call payload to keep title/kind/locations.
        existing.event =
          existing.event.kind === CodingEventKind.ToolCall &&
          normalizedEvent.kind === CodingEventKind.ToolCall
            ? {
                ...normalizedEvent,
                payload: { ...existing.event.payload, ...normalizedEvent.payload },
              }
            : normalizedEvent;
      } else turn.activities.push({ id, kind: projectedActivityKind, event: normalizedEvent });
      continue;
    }

    if (event.kind === CodingEventKind.TurnComplete) {
      const turn = ensureTurn(event);
      turn.status = CodingConversationTurnStatus.Complete;
      currentTurn = null;
      continue;
    }
    if (event.kind === CodingEventKind.TurnCancelled) {
      const turn = ensureTurn(event);
      turn.status = CodingConversationTurnStatus.Cancelled;
      turn.statusDetail = getCodingEventText(event) || null;
      currentTurn = null;
      continue;
    }
    if (event.kind === CodingEventKind.TurnFailed) {
      const turn = ensureTurn(event);
      turn.status = CodingConversationTurnStatus.Failed;
      turn.statusDetail = getCodingEventText(event) || null;
      currentTurn = null;
    }
  }

  return turns.filter(
    turn =>
      turn.userMessage !== null ||
      turn.reasoning !== null ||
      turn.activities.length > 0 ||
      turn.assistantMessages.length > 0 ||
      turn.status !== null,
  );
};
