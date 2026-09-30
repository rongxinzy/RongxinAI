import type { CoworkErrorKind } from './coworkError';

/**
 * Transient runtime status pushed from the main process to the renderer.
 *
 * A notice is never persisted and carries only what the shared prompt needs:
 * the classified kind lets the renderer reuse the same Chinese copy as the
 * final error (`getUserErrorI18nKey`), while the raw message stays for
 * diagnostics.
 */
export interface RuntimeRetryNotice {
  /** Runtime session that is retrying (Cowork session id or coding lane session id). */
  sessionId: string;
  /** Classified failure Pi is retrying. */
  kind: CoworkErrorKind;
  /** Raw error text, for logs only. */
  message: string;
  /** Retry attempt Pi reported within the current turn (1-based). */
  attempt: number;
}
