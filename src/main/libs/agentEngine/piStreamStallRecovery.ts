/**
 * Stream-stall recovery for Pi sessions.
 *
 * When the PiStreamStallWatchdog reports a silent model stream, this module
 * owns the recovery flow: abort the dead turn, surface a sticky error, and
 * resume the session once from the persisted SQLite history. The adapter only
 * wires hooks; all state (the per-session auto-resume budget) lives here so
 * the flow stays unit-testable without the adapter.
 */

import { CoworkErrorKind, makeCoworkError, type CoworkError } from '../../../common/coworkError';
import { isLocalProviderName } from '../../../shared/providers';

/**
 * Stall threshold while waiting for model output. Hosted providers stream
 * heartbeats/deltas quickly; two minutes already allows twice the slowest
 * observed first-token latency of the self-hosted deployment.
 */
export const STREAM_STALL_TIMEOUT_MS = 120_000;
/**
 * Local and custom providers (llama.cpp, Ollama) emit nothing during prompt
 * evaluation, which can exceed two minutes for a large context on slow
 * hardware. They get a wider window so healthy long turns are not killed.
 */
export const STREAM_STALL_TIMEOUT_LOCAL_MS = 600_000;

/**
 * How many times a stalled turn is automatically resumed from the persisted
 * history. A second consecutive stall leaves the terminal error on screen.
 */
export const MAX_STREAM_STALL_AUTO_RESUMES = 1;

/** Hidden prompt used for the automatic resume after a stream stall. */
export const STREAM_STALL_RESUME_PROMPT =
  'The previous response stream stalled and was aborted. Continue from where the response was interrupted, and do not repeat work that is already complete.';

/** Per-session stall window: local/custom runtimes get the wide window. */
export function resolveStreamStallTimeoutMs(providerName: string, overrideMs?: number): number {
  if (overrideMs !== undefined) return overrideMs;
  return isLocalProviderName(providerName) || providerName.startsWith('custom_')
    ? STREAM_STALL_TIMEOUT_LOCAL_MS
    : STREAM_STALL_TIMEOUT_MS;
}

/** Minimal session view the recovery flow needs (structural subset of ActivePiSession). */
export interface PiStreamStallRecoverySession {
  isRunning: boolean;
  aborted: boolean;
  pendingError: { message: string; classified: CoworkError; sticky?: boolean } | null;
  piSession: {
    abortBash(): void;
    abort(): Promise<void>;
  };
}

export interface PiStreamStallRecoveryHooks {
  /** Current live session for the id, if any. */
  getSession(sessionId: string): PiStreamStallRecoverySession | undefined;
  /** True while an ask-user-question tool call waits for an answer. */
  hasPendingAskUserQuestion(sessionId: string): boolean;
  /** True while a coding elicitation waits for an answer. */
  hasPendingCodingElicitation(sessionId: string): boolean;
  /** True while a workbench approval waits for the user. */
  hasPendingApproval(sessionId: string): boolean;
  /** Persist and emit the session's pending error exactly once. */
  flushPendingError(sessionId: string): void;
  /** Surface a transient retry notice for the session. */
  emitRetryNotice(
    sessionId: string,
    notice: { kind: CoworkErrorKind; message: string; attempt: number },
  ): void;
  /** Rebuild and continue the session from persisted history. */
  resumeSession(sessionId: string, prompt: string): Promise<void>;
  /** Drop the session's watchdog timer so late events cannot re-arm a dead turn. */
  disposeWatchdog(sessionId: string): void;
}

export class PiStreamStallRecovery {
  /** Automatic stall resumes already attempted per session (bounded). */
  private readonly resumeCounts = new Map<string, number>();

  constructor(private readonly hooks: PiStreamStallRecoveryHooks) {}

  /**
   * True while the session waits on user input: a pending ask-user question, a
   * coding elicitation, or a workbench approval. Pi emits nothing in that
   * state, so the stream-stall watchdog must stand down.
   */
  isAwaitingUserInput(sessionId: string): boolean {
    return (
      this.hooks.hasPendingAskUserQuestion(sessionId) ||
      this.hooks.hasPendingCodingElicitation(sessionId) ||
      this.hooks.hasPendingApproval(sessionId)
    );
  }

  /**
   * Watchdog callback: the model stream went silent mid-turn without any Pi
   * event, which the runtime never reports on its own. Abort the turn, surface
   * a sticky error, and let the next continueSession rebuild the Pi session
   * from the persisted history (an aborted Pi session is not reusable).
   *
   * An already recorded pending error (e.g. a transient failure mid auto-retry)
   * keeps its classification; the stall is appended to its message instead of
   * replacing the error the user should act on.
   */
  handleStall(sessionId: string): void {
    const session = this.hooks.getSession(sessionId);
    if (!session || session.aborted || !session.isRunning) return;
    console.warn(
      `[PiRuntime] session ${sessionId} produced no model stream activity within the stall timeout; aborting the turn`,
    );
    const existing = session.pendingError;
    const message = existing
      ? `${existing.message} (additionally, the stream stalled: no model output arrived, so the turn was aborted)`
      : 'The model stopped responding: no stream output arrived within the watchdog window, so the turn was aborted.';
    session.pendingError = {
      message,
      classified:
        existing?.classified ?? makeCoworkError(CoworkErrorKind.StreamInterrupted, message),
      sticky: true,
    };
    session.piSession.abortBash();
    void session.piSession.abort().catch((error: unknown) => {
      console.warn('[PiRuntime] failed to abort a stalled session:', error);
    });
    session.aborted = true;
    this.hooks.disposeWatchdog(sessionId);
    this.hooks.flushPendingError(sessionId);
    this.resume(sessionId, message);
  }

  /**
   * Automatically resumes a stalled turn once, via a hidden continueSession
   * that rebuilds the Pi session from the SQLite history. A second consecutive
   * stall leaves the terminal error on screen instead of looping forever.
   */
  private resume(sessionId: string, stallMessage: string): void {
    const attempts = this.resumeCounts.get(sessionId) ?? 0;
    if (attempts >= MAX_STREAM_STALL_AUTO_RESUMES) return;
    this.resumeCounts.set(sessionId, attempts + 1);
    this.hooks.emitRetryNotice(sessionId, {
      kind: CoworkErrorKind.StreamInterrupted,
      message: stallMessage,
      attempt: attempts + 1,
    });
    this.hooks.resumeSession(sessionId, STREAM_STALL_RESUME_PROMPT).catch((error: unknown) => {
      console.error('[PiRuntime] automatic resume after a stream stall failed:', error);
    });
  }

  /** A user-initiated turn or a completed turn earns a fresh auto-resume budget. */
  resetResumeBudget(sessionId: string): void {
    this.resumeCounts.delete(sessionId);
  }

  forgetSession(sessionId: string): void {
    this.resumeCounts.delete(sessionId);
  }

  disposeAll(): void {
    this.resumeCounts.clear();
  }
}
