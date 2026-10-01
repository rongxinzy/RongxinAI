/**
 * Pi seeds every assistant message's `usage` with zeros and only replaces it
 * once the provider actually reports one, so an all-zero record means "not
 * reported" rather than a measurement: any real step bills at least one prompt
 * token. Consumers must omit such a reading instead of rendering zeros, matching
 * the harness rule that metrics degrade by omission.
 */
export function hasReportedTokenUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
}): boolean {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.totalTokens,
  ].some(value => typeof value === 'number' && Number.isFinite(value) && value > 0);
}
