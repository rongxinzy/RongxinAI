import {
  PiAssistantStopReason,
  PiContentBlockType,
  type PiSteeringSession,
  type PiWriteRecoveryMessage,
} from './piWriteTokenLimit';

const MAX_ANSWER_CONTINUATION_ATTEMPTS = 1;

/**
 * Detect a pure-text truncation: the assistant hit the output token limit
 * (`stopReason === 'length'`) and produced no tool calls. The Pi agent loop
 * only auto-continues a turn when the truncated message carries tool calls
 * (they are all failed and the loop re-prompts); without tool calls the run
 * ends right after this message, silently presenting truncated text as a
 * complete answer.
 */
export const isPiPureTextTruncation = (message: PiWriteRecoveryMessage): boolean => {
  if (message.stopReason !== PiAssistantStopReason.Length) return false;
  if (typeof message.content === 'string') return true;
  if (!Array.isArray(message.content)) return false;
  return !message.content.some(block => block.type === PiContentBlockType.ToolCall);
};

/**
 * Bounded recovery for pure-text truncated answers.
 *
 * Queues at most ONE continuation steer per user turn: the steer lands in the
 * agent's steering queue while the run is still active, so the agent loop
 * makes one more model call instead of ending (verified against the actual
 * SDK with a fake provider — see reports/pi-stop-recovery.md). When the
 * continuation is also truncated, the budget is exhausted and the caller must
 * surface an explicit terminal reason instead of marking the run successful.
 *
 * Cancelling is inherited from the session: a user stop aborts the Pi run, so
 * the queued continuation never executes.
 */
export class PiTruncatedAnswerRecovery {
  private continuationAttempts = 0;
  private generation = 0;

  reset(): void {
    this.generation += 1;
    this.continuationAttempts = 0;
  }

  queueIfNeeded(message: PiWriteRecoveryMessage, session: PiSteeringSession): boolean {
    if (!isPiPureTextTruncation(message)) return false;
    if (this.continuationAttempts >= MAX_ANSWER_CONTINUATION_ATTEMPTS) return false;

    const queuedGeneration = this.generation;
    this.continuationAttempts += 1;
    const prompt = [
      'Your previous response was cut off by the output token limit before it was complete.',
      'Continue exactly where the previous response stopped.',
      'Do not repeat text that was already produced, do not re-run tools, and finish the remaining part concisely.',
    ].join(' ');

    const rollback = (error: unknown): void => {
      if (queuedGeneration === this.generation) {
        this.continuationAttempts = Math.max(0, this.continuationAttempts - 1);
      }
      console.warn('[PiTruncatedAnswerRecovery] failed to queue continuation steer:', error);
    };

    try {
      void session.steer(prompt).catch(error => rollback(error));
    } catch (error) {
      rollback(error);
      return false;
    }
    return true;
  }
}
