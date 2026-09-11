/**
 * Classifies endpoint rejections that mean "this model/endpoint cannot accept
 * a tools payload". Used by the optimistic web-search path: models whose
 * tool-calling capability is Unknown are first tried with tools, and only a
 * recognized rejection triggers the plain-chat fallback.
 */

const TOOL_UNSUPPORTED_STATUS_CODES: ReadonlySet<number> = new Set([400, 404, 422]);

const TOOL_UNSUPPORTED_PATTERNS: readonly RegExp[] = [
  /does not support (?:tools?|tool calls?|function calls?|function calling)/i,
  /tools? (?:are|is) not supported/i,
  /function calling is (?:not supported|unavailable)/i,
  /tool_?choice[^"]*(?:requires|not supported|unsupported)/i,
  /--enable-auto-tool-choice/i,
  /tool parser[^"]*not (?:configured|available)/i,
];

/**
 * Duck-typed on purpose: api.ts imports this module, so importing ApiError
 * here would create a cycle. Any Error with an optional numeric statusCode
 * (ApiError-compatible) is accepted.
 */
export function isToolCallUnsupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const statusCode = (error as Error & { statusCode?: unknown }).statusCode;
  if (statusCode !== undefined) {
    if (typeof statusCode !== 'number' || !TOOL_UNSUPPORTED_STATUS_CODES.has(statusCode)) {
      return false;
    }
  }
  return TOOL_UNSUPPORTED_PATTERNS.some(pattern => pattern.test(error.message));
}
