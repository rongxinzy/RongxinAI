import { randomUUID } from 'node:crypto';
import {
  CoworkRunPhase,
  CoworkRunPolicy,
  PiRunEvent,
  type CoworkRunSnapshot,
} from '../../../shared/cowork/runState';
import { getPiPreparingToolActivity } from './toolActivity';

export interface PiRunProgressEvent {
  type: string;
  attempt?: number;
  delayMs?: number;
  toolCallId?: string;
  toolName?: string;
  partialResult?: unknown;
  assistantMessageEvent?: {
    type: string;
    contentIndex?: number;
    partial?: unknown;
    toolCall?: unknown;
  };
}

const ACTIVITY_TARGET_KEYS = [
  'path',
  'filePath',
  'file_path',
  'targetFile',
  'target_file',
] as const;

const readActivityTarget = (input: Record<string, unknown> | undefined): string | undefined => {
  if (!input) return undefined;
  for (const key of ACTIVITY_TARGET_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
};

/** Bounded projection only: never stringify arbitrary tool objects on the agent stream path. */
export function getToolProgressPreview(value: unknown): string {
  if (typeof value === 'string') return value.slice(-CoworkRunPolicy.PreviewCharacters);
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return getToolProgressPreview(record.text);
  if (typeof record.content === 'string') return getToolProgressPreview(record.content);
  const blocks = Array.isArray(value) ? value : Array.isArray(record.content) ? record.content : [];
  return blocks
    .slice(-8)
    .map(block => {
      if (!block || typeof block !== 'object') return '';
      const text = (block as Record<string, unknown>).text;
      return typeof text === 'string' ? text.slice(-CoworkRunPolicy.PreviewCharacters) : '';
    })
    .join('\n')
    .slice(-CoworkRunPolicy.PreviewCharacters);
}

export class PiRunStateTracker {
  private readonly tools = new Map<
    string,
    Map<string, { toolName?: string; startedAt: number; preview?: string }>
  >();
  private readonly states = new Map<string, CoworkRunSnapshot>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lastEmittedAt = new Map<string, number>();

  constructor(private readonly publish: (snapshot: CoworkRunSnapshot) => void) {}

  observe(sessionId: string, event: PiRunProgressEvent): void {
    if (event.type === PiRunEvent.AgentStart) {
      this.clearTimer(sessionId);
      const now = Date.now();
      const existing = this.states.get(sessionId);
      this.states.set(sessionId, {
        sessionId,
        runId: existing?.running ? existing.runId : randomUUID(),
        sequence: existing?.running ? existing.sequence : 0,
        phase: CoworkRunPhase.Waiting,
        running: true,
        startedAt: existing?.running
          ? existing.startedAt
          : Math.max(now, (existing?.startedAt ?? 0) + 1),
        confirmedAt: now,
        lastProgressAt: now,
      });
      this.emit(sessionId);
      for (const [id, entry] of this.states) {
        if (this.states.size <= 256) break;
        if (!entry.running) this.delete(id);
      }
      return;
    }
    const state = this.states.get(sessionId);
    if (!state?.running) return;
    let phase: CoworkRunPhase | undefined;
    switch (event.type) {
      case PiRunEvent.MessageStart:
        phase = CoworkRunPhase.Waiting;
        break;
      case PiRunEvent.MessageUpdate: {
        const assistantEvent = event.assistantMessageEvent;
        if (
          assistantEvent?.type === PiRunEvent.ToolCallStart ||
          assistantEvent?.type === PiRunEvent.ToolCallDelta
        ) {
          // Streaming tool arguments: keep the run alive and surface which
          // tool (and target) is being generated.
          phase = CoworkRunPhase.Tool;
          const activity = getPiPreparingToolActivity(assistantEvent, '');
          if (activity) {
            if (activity.toolName) state.toolName = activity.toolName;
            const preview = [activity.toolName, readActivityTarget(activity.toolInput)]
              .filter(Boolean)
              .join(' ');
            if (preview) state.preview = preview;
          }
          break;
        }
        phase =
          assistantEvent?.type === PiRunEvent.ThinkingDelta
            ? CoworkRunPhase.Thinking
            : assistantEvent?.type === PiRunEvent.TextDelta
              ? CoworkRunPhase.Writing
              : undefined;
        break;
      }
      case PiRunEvent.ToolStart:
        phase = CoworkRunPhase.Tool;
        state.toolName = event.toolName;
        state.toolStartedAt = Date.now();
        state.preview = undefined;
        if (event.toolCallId) {
          const tools = this.tools.get(sessionId) ?? new Map();
          if (tools.size < 64)
            tools.set(event.toolCallId, { toolName: event.toolName, startedAt: Date.now() });
          this.tools.set(sessionId, tools);
        }
        break;
      case PiRunEvent.ToolUpdate:
        phase = CoworkRunPhase.Tool;
        state.preview = getToolProgressPreview(event.partialResult) || state.preview;
        if (event.toolCallId) {
          const tool = this.tools.get(sessionId)?.get(event.toolCallId);
          if (tool) {
            tool.preview = getToolProgressPreview(event.partialResult) || tool.preview;
            state.toolName = tool.toolName;
            state.toolStartedAt = tool.startedAt;
            state.preview = tool.preview;
          }
        }
        break;
      case PiRunEvent.ToolEnd: {
        if (event.toolCallId) this.tools.get(sessionId)?.delete(event.toolCallId);
        const remaining = Array.from(this.tools.get(sessionId)?.values() ?? []).at(-1);
        phase = remaining ? CoworkRunPhase.Tool : CoworkRunPhase.Waiting;
        state.toolName = remaining?.toolName;
        state.toolStartedAt = remaining?.startedAt;
        state.preview = remaining?.preview;
        break;
      }
      case PiRunEvent.RetryStart:
        phase = CoworkRunPhase.Retry;
        state.retryAttempt = event.attempt;
        state.retryAt = Date.now() + Math.max(0, event.delayMs ?? 0);
        break;
      case PiRunEvent.RetryEnd:
        phase = CoworkRunPhase.Waiting;
        break;
      case PiRunEvent.CompactStart:
        phase = CoworkRunPhase.Compacting;
        break;
      case PiRunEvent.CompactEnd:
        phase = CoworkRunPhase.Waiting;
        break;
      case PiRunEvent.AgentEnd:
        phase = CoworkRunPhase.Finishing;
        break;
      default:
        return;
    }
    if (!phase) return;
    const phaseChanged = phase !== state.phase;
    state.phase = phase;
    state.lastProgressAt = Date.now();
    if (
      phaseChanged ||
      Date.now() - (this.lastEmittedAt.get(sessionId) ?? 0) >= CoworkRunPolicy.EmitMs
    ) {
      this.emit(sessionId);
    } else if (!this.timers.has(sessionId)) {
      this.timers.set(
        sessionId,
        setTimeout(() => this.emit(sessionId), CoworkRunPolicy.EmitMs),
      );
    }
  }

  setPhase(sessionId: string, phase: CoworkRunPhase): void {
    const state = this.states.get(sessionId);
    if (!state?.running) return;
    state.phase = phase;
    state.lastProgressAt = Date.now();
    this.emit(sessionId);
  }

  finish(sessionId: string, phase: CoworkRunPhase): void {
    const state = this.states.get(sessionId);
    if (!state) return;
    state.running = false;
    this.tools.delete(sessionId);
    state.phase = phase;
    this.emit(sessionId);
  }

  snapshot(sessionId: string): CoworkRunSnapshot | null {
    const state = this.states.get(sessionId);
    return state ? { ...state, confirmedAt: Date.now() } : null;
  }

  delete(sessionId: string): void {
    this.clearTimer(sessionId);
    this.states.delete(sessionId);
    this.tools.delete(sessionId);
    this.lastEmittedAt.delete(sessionId);
  }

  private clearTimer(sessionId: string): void {
    clearTimeout(this.timers.get(sessionId));
    this.timers.delete(sessionId);
  }

  private emit(sessionId: string): void {
    this.clearTimer(sessionId);
    const state = this.states.get(sessionId);
    if (!state) return;
    state.sequence += 1;
    state.confirmedAt = Date.now();
    this.lastEmittedAt.set(sessionId, state.confirmedAt);
    this.publish({ ...state });
  }
}
