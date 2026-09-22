import type { CoworkError } from '../common/coworkError';
import { classifyCoworkError } from '../common/coworkError';
import { CoworkSessionStatus } from '../shared/cowork/constants';

/** Feed rejected startup/continuation promises into the same persisted error
 * and sequenced UI event path as native runtime errors. */
export function reportPiSessionFailure(
  runtime: { emit(event: 'error', sessionId: string, error: CoworkError): boolean },
  sessionId: string,
  error: unknown,
  persistedStatus: string | undefined,
): void {
  if (persistedStatus === CoworkSessionStatus.Error) return;
  const message = error instanceof Error ? error.message : String(error);
  runtime.emit('error', sessionId, classifyCoworkError(message));
}
