/**
 * Forced output-contract correction.
 *
 * When the workbench output-contract gate hits its first denial ceiling (the
 * model keeps calling non-read-only tools without committing set_task_output),
 * the run gets one forced correction instead of an immediate kill: the live Pi
 * session is steered into exactly one set_task_output call and the gate grants
 * the run a bounded grace of extra denials. Only a run that keeps violating
 * the gate after the steer is failed and terminated.
 */

/** Steer injected when the output-contract gate hits its first denial ceiling. */
export const OUTPUT_CONTRACT_CORRECTION_STEER =
  'You have called tools without committing the required output contract. Your next action MUST be exactly one set_task_output tool call that declares the deliverables. Do not call any other tool first.';

/** Minimal session view the correction needs (structural subset of ActivePiSession). */
export interface PiOutputContractCorrectionSession {
  aborted: boolean;
  isRunning: boolean;
  piSession: {
    steer(text: string): Promise<void>;
  };
}

export interface PiOutputContractCorrectionHooks {
  /** Current live session for the id, if any. */
  getSession(sessionId: string): PiOutputContractCorrectionSession | undefined;
  /** Grant the run its one grace window; false when it was already spent. */
  grantCorrectionGrace(runId: string): boolean;
  /** Fail the session's active workbench run. */
  failRun(sessionId: string): void;
  /** End the turn with a visible error. */
  endTurn(sessionId: string, reason: string | undefined): void;
}

export class PiOutputContractCorrection {
  constructor(private readonly hooks: PiOutputContractCorrectionHooks) {}

  enforce(sessionId: string, runId: string, reason: string | undefined): void {
    const session = this.hooks.getSession(sessionId);
    const canSteer = Boolean(session && !session.aborted && session.isRunning);
    const graceGranted = canSteer && this.hooks.grantCorrectionGrace(runId);
    if (session && graceGranted) {
      console.warn(
        `[PiRuntime] steering session ${sessionId} back to the output contract after repeated gate denials`,
      );
      void session.piSession.steer(OUTPUT_CONTRACT_CORRECTION_STEER).catch((error: unknown) => {
        console.error('[PiRuntime] failed to steer the output contract correction:', error);
      });
      return;
    }
    // The session cannot take a steer (stopped or aborted) or the grace was
    // already spent: fail and terminate the run as before.
    this.hooks.failRun(sessionId);
    this.hooks.endTurn(sessionId, reason);
  }
}
