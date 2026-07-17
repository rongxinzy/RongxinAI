/**
 * Backward-compatible shim for error classification.
 *
 * This file now delegates to the typed CoworkError model in coworkError.ts.
 * Existing callers that only need an i18n key continue to work unchanged.
 * New code should use classifyCoworkError() directly for structured errors.
 */

import { classifyCoworkError, getUserErrorI18nKey } from './coworkError';

export type { CoworkError, ErrorLogLevel } from './coworkError';
export {
  classifyCoworkError,
  CoworkErrorKind,
  ENGINE_NOT_READY_CODE,
  getErrorLogLevel,
  getUserErrorI18nKey,
  isTransient,
  makeCoworkError,
} from './coworkError';

/**
 * Classify an error string and return the matching i18n key.
 * Returns null if no rule matches (caller should fall back to the original error).
 *
 * @deprecated Prefer classifyCoworkError() for structured error handling.
 *             This function remains for callers that only need an i18n key.
 */
export function classifyErrorKey(error: string): string | null {
  const classified = classifyCoworkError(error);
  if (classified.kind === 'unknown' && !isKnownError(error)) {
    return null;
  }
  return getUserErrorI18nKey(classified.kind);
}

/** Check if the error string matches any known pattern. */
function isKnownError(error: string): boolean {
  // Only return null for truly unmatched errors, not for "unknown" kind
  const knownPatterns = [/unknown error|an unknown error occurred/i];
  return knownPatterns.some(p => p.test(error));
}
