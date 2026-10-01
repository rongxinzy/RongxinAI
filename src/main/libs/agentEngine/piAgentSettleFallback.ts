/**
 * Fallback for the agent_settled completion signal.
 *
 * The adapter completes workbench runs on agent_settled, not agent_end: Pi may
 * follow agent_end with an automatic compaction continuation turn, and
 * completing at agent_end would terminate the run before that continuation's
 * first tool call (agent_settled is emitted exactly once per prompt, in a
 * finally that covers normal completion, aborts, errors, and all
 * continuations).
 *
 * This timer is pure insurance for a settle that never arrives. It is armed by
 * an agent_end that reached the completion point and cancelled by ANY other
 * event: any activity proves the run either settled or continues, in which
 * case the fallback must not fire. On expiry the turn is settled anyway so a
 * run cannot wedge half-finished.
 */

import { PiAgentEventType } from './piStreamConstants';

export const AGENT_SETTLE_FALLBACK_MS = 15_000;

export class PiAgentSettleFallback {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly onSettle: (sessionId: string) => void,
    private readonly delayMs: number = AGENT_SETTLE_FALLBACK_MS,
  ) {}

  /** Arms the fallback after an agent_end that reached the completion point. */
  arm(sessionId: string): void {
    this.dispose(sessionId);
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      console.warn(
        `[PiRuntime] session ${sessionId} did not emit agent_settled after agent_end; settling the run via the fallback timer`,
      );
      this.onSettle(sessionId);
    }, this.delayMs);
    // A fallback must never keep the process alive on its own.
    timer.unref();
    this.timers.set(sessionId, timer);
  }

  /** Feeds one raw Pi event: anything that is not agent_end cancels the fallback. */
  handleEvent(sessionId: string, eventType: string): void {
    if (eventType === PiAgentEventType.AgentEnd) return;
    this.dispose(sessionId);
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
}
