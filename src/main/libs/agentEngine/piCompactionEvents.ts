/** Preserve native compaction diagnostics without taking over recovery. */
import { classifyCoworkError } from '../../../common/coworkError';
import { PiAgentEventType, PiCompactionReason } from './piStreamConstants';
import { isPiFinalResponse } from './piFinalResponse';
import type { ActivePiSession, PiEvent } from './piRuntimeSessionState';

export function handlePiCompactionEvent(
  sessionId: string,
  active: ActivePiSession,
  event: PiEvent,
): boolean {
  if (event.type === PiAgentEventType.CompactionStart) {
    console.log(`[PiRuntime] compaction started for session ${sessionId} (${event.reason})`);
    return true;
  }
  if (event.type !== PiAgentEventType.CompactionEnd) return false;
  if (event.errorMessage) {
    console.warn(`[PiRuntime] compaction failed for session ${sessionId}: ${event.errorMessage}`);
    // Defer the error to normal settlement. No prompt, abort, or retry is
    // injected here; a successful native continuation can still clear it.
    // A maintenance failure after a valid final response does not undo work
    // already finished. Preserve the cause when recovery itself was required.
    const unfinished =
      !active.lastAssistantMessage || !isPiFinalResponse(active.lastAssistantMessage);
    if (
      !event.aborted &&
      event.reason !== PiCompactionReason.Manual &&
      !active.errorSurfaced &&
      unfinished
    ) {
      active.pendingError = {
        message: event.errorMessage,
        classified: classifyCoworkError(event.errorMessage),
      };
      active.turnFailed = true;
    }
  } else if (event.aborted) {
    console.log(`[PiRuntime] compaction cancelled for session ${sessionId}`);
  } else if (event.result) {
    // The SDK event crosses an untyped module boundary. Read only scalar
    // diagnostics; never stringify the potentially large summary/history.
    const result = event.result as { tokensBefore?: unknown; estimatedTokensAfter?: unknown };
    const before = typeof result.tokensBefore === 'number' ? result.tokensBefore : 'unknown';
    const after =
      typeof result.estimatedTokensAfter === 'number' ? result.estimatedTokensAfter : 'unknown';
    console.log(
      `[PiRuntime] compaction completed for session ${sessionId} from ${before} to ${after} estimated tokens`,
    );
  }
  return true;
}
