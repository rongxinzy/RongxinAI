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
 * are tolerated because a listener can attach after a session has started;
 * ordering is still enforced for every event it has observed.
 */
export class PiUiEventSequenceTracker {
  private readonly lastSequenceBySession = new Map<string, number>();

  accept(event: unknown): event is PiUiEvent {
    if (!isPiUiEvent(event)) return false;
    const sequenceKey = event.sessionId ?? '__global__';
    const previous = this.lastSequenceBySession.get(sequenceKey);
    if (previous !== undefined && event.sequence <= previous) return false;
    this.lastSequenceBySession.set(sequenceKey, event.sequence);
    return true;
  }
}

export const isPiUiEvent = (value: unknown): value is PiUiEvent => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PiUiEvent>;
  return (
    candidate.protocolVersion === PI_UI_EVENT_PROTOCOL_VERSION &&
    typeof candidate.eventId === 'string' &&
    candidate.eventId.length > 0 &&
    typeof candidate.sequence === 'number' &&
    Number.isInteger(candidate.sequence) &&
    candidate.sequence > 0 &&
    typeof candidate.emittedAt === 'number' &&
    Number.isFinite(candidate.emittedAt) &&
    typeof candidate.type === 'string'
  );
};
