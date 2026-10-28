/** Turn-end summary obligation, decided only from host-side facts. */
export type SummaryObligation = 'none' | 'fallback';

export function evaluateSummaryObligation(input: {
  hasRecordedFiles: boolean;
  checkpointWritten: boolean;
  checkpointSkipped: boolean;
}): SummaryObligation {
  return !input.hasRecordedFiles || input.checkpointWritten || input.checkpointSkipped
    ? 'none'
    : 'fallback';
}
