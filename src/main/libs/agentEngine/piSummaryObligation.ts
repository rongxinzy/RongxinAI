/** Turn-end summary obligation, decided only from host-side facts. */
export type SummaryObligation = 'none' | 'fallback';

export function evaluateSummaryObligation(input: {
  hasRecordedFiles: boolean;
  checkpointWritten: boolean;
  checkpointSkipped: boolean;
  workVersion: number;
  coveredWorkVersion?: number;
}): SummaryObligation {
  const covered =
    (input.checkpointWritten || input.checkpointSkipped) &&
    input.coveredWorkVersion === input.workVersion;
  return !input.hasRecordedFiles || covered ? 'none' : 'fallback';
}
