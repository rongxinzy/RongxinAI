import type { CoworkError } from '../../common/coworkError';
import type { CoworkPendingMessage } from './pendingMessageQueue';
import type { CoworkSessionInterruption } from './interruption';
import type { CoworkToolActivityEvent } from './toolActivity';

export const PiUiEventType = {
  Started: 'started',
  Message: 'message',
  MessageUpdate: 'message_update',
  ToolActivity: 'tool_activity',
  PermissionRequest: 'permission_request',
  PermissionDismiss: 'permission_dismiss',
  Interrupted: 'interrupted',
  Completed: 'completed',
  Error: 'error',
  QueueUpdated: 'queue_updated',
  Stopped: 'stopped',
} as const;

export type PiUiEventType = (typeof PiUiEventType)[keyof typeof PiUiEventType];

export const PI_UI_EVENT_PROTOCOL_VERSION = 1 as const;

export type PiUiMessage = {
  id: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  content: string;
  timestamp: number;
  /** Persisted message order within the Pi session, when available. */
  sequence?: number;
  metadata?: Record<string, unknown>;
};

type PiUiEventBase = {
  protocolVersion: typeof PI_UI_EVENT_PROTOCOL_VERSION;
  eventId: string;
  sequence: number;
  emittedAt: number;
  sessionId: string | null;
};

export type PiUiEvent =
  | (PiUiEventBase & { type: typeof PiUiEventType.Started; sessionId: string })
  | (PiUiEventBase & { type: typeof PiUiEventType.Message; sessionId: string; message: PiUiMessage })
  | (PiUiEventBase & {
      type: typeof PiUiEventType.MessageUpdate;
      sessionId: string;
      messageId: string;
      content: string;
      metadata?: Record<string, unknown>;
    })
  | (PiUiEventBase & {
      type: typeof PiUiEventType.ToolActivity;
      sessionId: string;
      event: CoworkToolActivityEvent;
    })
  | (PiUiEventBase & {
      type: typeof PiUiEventType.PermissionRequest;
      sessionId: string;
      request: {
        requestId: string;
        toolName: string;
        toolInput: Record<string, unknown>;
        toolUseId?: string | null;
      };
    })
  | (PiUiEventBase & {
      type: typeof PiUiEventType.PermissionDismiss;
      requestId: string;
    })
  | (PiUiEventBase & {
      type: typeof PiUiEventType.Interrupted;
      sessionId: string;
      interruption: CoworkSessionInterruption;
    })
  | (PiUiEventBase & {
      type: typeof PiUiEventType.Completed;
      sessionId: string;
      claudeSessionId: string | null;
    })
  | (PiUiEventBase & { type: typeof PiUiEventType.Error; sessionId: string; error: CoworkError })
  | (PiUiEventBase & {
      type: typeof PiUiEventType.QueueUpdated;
      sessionId: string;
      items: CoworkPendingMessage[];
    })
  | (PiUiEventBase & { type: typeof PiUiEventType.Stopped; sessionId: string });

export type PiUiEventPayload = PiUiEvent extends infer Event
  ? Event extends PiUiEvent
    ? Omit<Event, 'protocolVersion' | 'eventId' | 'sequence' | 'emittedAt'>
    : never
  : never;

export class PiUiEventSequencer {
  private readonly sequenceBySession = new Map<string, number>();

  constructor(
    private readonly createEventId: () => string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  next(payload: PiUiEventPayload): PiUiEvent {
    const sequenceKey = payload.sessionId ?? '__global__';
    const sequence = (this.sequenceBySession.get(sequenceKey) ?? 0) + 1;
    this.sequenceBySession.set(sequenceKey, sequence);
    return {
      ...payload,
      protocolVersion: PI_UI_EVENT_PROTOCOL_VERSION,
      eventId: this.createEventId(),
      sequence,
      emittedAt: this.now(),
    } as PiUiEvent;
  }
}

/**
 * Guards a renderer consumer against duplicate or late IPC deliveries. Gaps
 * trigger recovery, including a first delivery above sequence one after a
 * late listener attachment. Ordering is enforced for every observed event.
 */
export class PiUiEventSequenceTracker {
  private readonly lastSequenceBySession = new Map<string, number>();
  private readonly gapsBySession = new Map<string, number>();

  accept(event: unknown): event is PiUiEvent {
    if (!isPiUiEvent(event)) return false;
    const sequenceKey = event.sessionId ?? '__global__';
    const previous = this.lastSequenceBySession.get(sequenceKey);
    if (previous !== undefined && event.sequence <= previous) return false;
    if (event.sequence !== (previous ?? 0) + 1) {
      this.gapsBySession.set(sequenceKey, (this.gapsBySession.get(sequenceKey) ?? 0) + 1);
    }
    this.lastSequenceBySession.set(sequenceKey, event.sequence);
    return true;
  }

  /** Returns and clears the number of sequence gaps observed for a stream. */
  consumeGap(sessionId: string | null): number {
    const sequenceKey = sessionId ?? '__global__';
    const gaps = this.gapsBySession.get(sequenceKey) ?? 0;
    this.gapsBySession.delete(sequenceKey);
    return gaps;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isSessionId = (value: unknown): value is string => isNonEmptyString(value);

const isPiUiMessage = (value: unknown): value is PiUiMessage => {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    (value.type === 'user' ||
      value.type === 'assistant' ||
      value.type === 'tool_use' ||
      value.type === 'tool_result' ||
      value.type === 'system') &&
    typeof value.content === 'string' &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    (value.sequence === undefined ||
      (typeof value.sequence === 'number' && Number.isInteger(value.sequence) && value.sequence > 0)) &&
    (value.metadata === undefined || isRecord(value.metadata))
  );
};

const isCoworkError = (value: unknown): boolean =>
  isRecord(value) && isNonEmptyString(value.kind) && typeof value.message === 'string';

const isToolActivityEvent = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.type === 'clear') return true;
  if (value.type === 'remove') return isNonEmptyString(value.toolCallId);
  if (value.type !== 'upsert' || !isRecord(value.activity)) return false;
  return (
    isNonEmptyString(value.activity.toolCallId) &&
    (value.activity.phase === 'preparing' || value.activity.phase === 'running') &&
    typeof value.activity.updatedAt === 'number' &&
    Number.isFinite(value.activity.updatedAt)
  );
};

const isInterruption = (value: unknown): boolean =>
  isRecord(value) &&
  isSessionId(value.sessionId) &&
  isNonEmptyString(value.interruptionId) &&
  (value.cause === 'user_stop' ||
    value.cause === 'approval_denied' ||
    value.cause === 'runtime_paused') &&
  (value.taskId === null || isNonEmptyString(value.taskId)) &&
  typeof value.recoverable === 'boolean';

const isQueuedMessage = (value: unknown): boolean =>
  isRecord(value) &&
  isNonEmptyString(value.id) &&
  isNonEmptyString(value.text) &&
  (value.delivery === 'steer' || value.delivery === 'followUp') &&
  (value.status === 'pending' || value.status === 'sending' || value.status === 'failed') &&
  typeof value.createdAt === 'number' &&
  Number.isFinite(value.createdAt);

export const isPiUiEvent = (value: unknown): value is PiUiEvent => {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<PiUiEvent>;
  if (
    candidate.protocolVersion !== PI_UI_EVENT_PROTOCOL_VERSION ||
    !isNonEmptyString(candidate.eventId) ||
    typeof candidate.sequence !== 'number' ||
    !Number.isInteger(candidate.sequence) ||
    candidate.sequence <= 0 ||
    typeof candidate.emittedAt !== 'number' ||
    !Number.isFinite(candidate.emittedAt) ||
    (candidate.sessionId !== null && !isSessionId(candidate.sessionId))
  ) {
    return false;
  }

  switch (candidate.type) {
    case PiUiEventType.Started:
      return isSessionId(candidate.sessionId);
    case PiUiEventType.Message:
      return isSessionId(candidate.sessionId) && isPiUiMessage(candidate.message);
    case PiUiEventType.MessageUpdate:
      return (
        isSessionId(candidate.sessionId) &&
        isNonEmptyString(candidate.messageId) &&
        typeof candidate.content === 'string' &&
        (candidate.metadata === undefined || isRecord(candidate.metadata))
      );
    case PiUiEventType.ToolActivity:
      return isSessionId(candidate.sessionId) && isToolActivityEvent(candidate.event);
    case PiUiEventType.PermissionRequest: {
      const request = candidate.request;
      return (
        isSessionId(candidate.sessionId) &&
        isRecord(request) &&
        isNonEmptyString(request.requestId) &&
        isNonEmptyString(request.toolName) &&
        isRecord(request.toolInput) &&
        (request.toolUseId === undefined || request.toolUseId === null || isNonEmptyString(request.toolUseId))
      );
    }
    case PiUiEventType.PermissionDismiss:
      return candidate.sessionId === null && isNonEmptyString(candidate.requestId);
    case PiUiEventType.Interrupted:
      return isSessionId(candidate.sessionId) && isInterruption(candidate.interruption);
    case PiUiEventType.Completed:
      return (
        isSessionId(candidate.sessionId) &&
        (candidate.claudeSessionId === null || isNonEmptyString(candidate.claudeSessionId))
      );
    case PiUiEventType.Error:
      return isSessionId(candidate.sessionId) && isCoworkError(candidate.error);
    case PiUiEventType.QueueUpdated:
      return (
        isSessionId(candidate.sessionId) &&
        Array.isArray(candidate.items) &&
        candidate.items.every(isQueuedMessage)
      );
    case PiUiEventType.Stopped:
      return isSessionId(candidate.sessionId);
    default:
      return false;
  }
};
