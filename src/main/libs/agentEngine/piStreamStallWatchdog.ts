/**
 * Stream stall watchdog for Pi sessions.
 *
 * Production incident: against a self-hosted model service the SSE stream
 * repeatedly died silently right after assistant `message_start` — no delta,
 * no error, no timeout from the runtime — leaving the UI spinning until the
 * user stopped the session by hand. The adapter arms this watchdog while it
 * waits for model output and aborts the turn when no Pi event arrives within
 * the timeout.
 *
 * The module owns only timing state. Everything it needs to know about a
 * session (whether it is waiting on user input, what to do on a stall, how
 * long the window is) is injected so the state machine stays unit-testable.
 */

import { PiAgentEventType } from './piStreamConstants';

/** Events that prove the session is waiting for model output: (re)arm the countdown. */
const ARMING_EVENTS: ReadonlySet<string> = new Set<string>([
  PiAgentEventType.AgentStart,
  PiAgentEventType.TurnStart,
  PiAgentEventType.MessageStart,
  PiAgentEventType.MessageUpdate,
  PiAgentEventType.ToolExecutionEnd,
  PiAgentEventType.AutoRetryStart,
  PiAgentEventType.CompactionEnd,
]);

/**
 * Events after which no model output is expected: stand the watchdog down.
 * Tool execution in particular may legitimately produce no events for a long
 * time (a bash command need not print anything), and context compaction on a
 * slow local model can exceed the stall window without emitting anything.
 */
const DISARMING_EVENTS: ReadonlySet<string> = new Set<string>([
  PiAgentEventType.ToolExecutionStart,
  PiAgentEventType.AgentEnd,
  PiAgentEventType.AgentSettled,
  PiAgentEventType.MessageEnd,
  PiAgentEventType.CompactionStart,
]);

export interface PiStreamStallWatchdogCallbacks {
  /**
   * True while the session waits on user input (a pending question, coding
   * elicitation, or tool approval). Pi legitimately emits nothing in that
   * state, so a firing watchdog must stand down instead of aborting the turn.
   */
  isSuspended(sessionId: string): boolean;
  /** Called once when no Pi event arrived within the timeout. */
  onStall(sessionId: string): void;
}

export class PiStreamStallWatchdog {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly callbacks: PiStreamStallWatchdogCallbacks,
    private readonly defaultTimeoutMs: number,
  ) {}

  /**
   * Feeds one Pi event observed at the subscription point (before any display
   * projection, so a busy transform pipeline cannot mask a dead stream).
   * Arming events (re)start the countdown, disarming events stand the watchdog
   * down, and every other event resets an already armed countdown: any
   * activity proves the stream is alive. `timeoutMs` overrides the window for
   * this session (local model servers need a wider one).
   */
  handleEvent(sessionId: string, eventType: string, timeoutMs?: number): void {
    if (DISARMING_EVENTS.has(eventType)) {
      this.dispose(sessionId);
      return;
    }
    if (ARMING_EVENTS.has(eventType) || this.timers.has(sessionId)) {
      this.arm(sessionId, timeoutMs ?? this.defaultTimeoutMs);
    }
  }

  isArmed(sessionId: string): boolean {
    return this.timers.has(sessionId);
  }

  dispose(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.timers.delete(sessionId);
  }

  disposeAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private arm(sessionId: string, timeoutMs: number): void {
    this.dispose(sessionId);
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      // The session turned out to be waiting on the user, not on the model.
      // The resolution of that interaction arrives as a Pi event and re-arms
      // the watchdog, so there is nothing to re-schedule here.
      if (this.callbacks.isSuspended(sessionId)) return;
      this.callbacks.onStall(sessionId);
    }, timeoutMs);
    // A watchdog must never keep the process alive on its own.
    timer.unref();
    this.timers.set(sessionId, timer);
  }
}
