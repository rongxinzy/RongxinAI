import {
  CodingEventKind,
  CodingStreamUpdateMode,
  type CodingAgentCapabilities,
  type CodingEvent,
} from '../../../shared/codingAgent';
import { AcpEventQueue } from '../acp/acpEventQueue';

/** Driver event shape before the coding room stamps identity and ordering. */
export type DriverEvent = Omit<CodingEvent, 'id' | 'laneId' | 'sequence' | 'createdAt'>;

/** Authentication method advertised by an ACP agent in its initialize result. */
export type AcpAuthMethod = { id: string; type?: string };

export type AcpInitializeResult = {
  protocolVersion?: unknown;
  agentCapabilities?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  authMethods?: AcpAuthMethod[];
};

export type AcpSessionResult = { sessionId?: string; configOptions?: unknown };

/** One in-flight prompt: queued events, waiting consumers, and terminal state. */
export type EventStream = {
  events: AcpEventQueue<DriverEvent>;
  waiters: Array<{
    resolve: (result: IteratorResult<DriverEvent>) => void;
    reject: (error: Error) => void;
  }>;
  done: boolean;
  error: Error | null;
};

/** A permission request the driver is holding open for the user's answer. */
export type PendingPermission = {
  streamSessionId: string;
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
};

/** Coalesces adjacent same-target events so a burst of updates stays readable. */
export const mergeAdjacentDriverEvents = (
  previous: DriverEvent,
  next: DriverEvent,
): DriverEvent | null => {
  if (
    previous.kind === CodingEventKind.MessageDelta &&
    next.kind === CodingEventKind.MessageDelta
  ) {
    const previousMessageId = previous.payload.messageId;
    if (previousMessageId !== next.payload.messageId || typeof previousMessageId !== 'string') {
      return null;
    }
    if (next.payload.streamUpdateMode === CodingStreamUpdateMode.Replace) return next;
    return {
      ...next,
      payload: {
        ...previous.payload,
        ...next.payload,
        content: `${typeof previous.payload.content === 'string' ? previous.payload.content : ''}${typeof next.payload.content === 'string' ? next.payload.content : ''}`,
      },
    };
  }
  if (previous.kind === CodingEventKind.ToolCall && next.kind === CodingEventKind.ToolCall) {
    return previous.payload.toolCallId === next.payload.toolCallId
      ? { ...next, payload: { ...previous.payload, ...next.payload } }
      : null;
  }
  return null;
};

/** Turn watchdog policy: renewed by progress, paused by legitimate waiting. */
export interface AcpTurnTimeouts {
  /** Silence budget for one turn; every `session/update` renews it. */
  inactivityMs: number;
  /** Hard ceiling for one turn that no progress or approval may extend. */
  absoluteMs: number;
}

export const DEFAULT_TURN_TIMEOUTS: AcpTurnTimeouts = {
  inactivityMs: 5 * 60 * 1000,
  absoluteMs: 60 * 60 * 1000,
};

/** ACP tool call statuses that mean the agent is still running the tool. */
export const OPEN_TOOL_CALL_STATUSES = new Set(['pending', 'in_progress']);

export const DEFAULT_CAPABILITIES: CodingAgentCapabilities = {
  supportsLoadSession: false,
  supportsResumeSession: false,
  supportsPlans: false,
  supportsPermissions: false,
  supportsFilesystem: false,
  supportsTerminal: false,
  supportsConfigOptions: false,
  supportsUsage: false,
  supportsElicitation: false,
};

// Starting or restoring a real coding-agent session may include launching the
// agent's own backend, loading account state, scanning skills, and enumerating
// models. Keep the short transport timeout for ordinary ACP control requests,
// but give lifecycle requests enough time to complete on a cold start.
export const ACP_SESSION_LIFECYCLE_TIMEOUT_MS = 60_000;

/**
 * How long a prompt may stay completely silent before the turn is failed.
 *
 * An ACP agent that cannot run the prompt — no signed-in account, missing or
 * invalid API key, unreachable model endpoint — does not report an error: Kimi
 * Code answers such a prompt with a bare `end_turn` after ~100s and writes
 * nothing to stderr, so the user would otherwise stare at a spinner until the
 * five-minute request cap. Any first event (thought, tool call, message) clears
 * the watchdog, so only a totally silent agent is cut short.
 */
export const ACP_FIRST_OUTPUT_TIMEOUT_MS = 90_000;

// Base64 media payloads above this size are replaced with a placeholder so a
// single screenshot cannot blow up the event stream, persistence, and the
// markdown renderer.
export const MAX_INLINE_DATA_LENGTH = 200_000;

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
