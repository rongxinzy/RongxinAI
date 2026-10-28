/** Turn-end summary obligation, decided only from host-side facts:
 * files produced, checkpoint written/skipped, reminder already issued. */
export type SummaryObligation = 'none' | 'remind' | 'fallback';

export function evaluateSummaryObligation(input: {
  hasRecordedFiles: boolean;
  checkpointWritten: boolean;
  checkpointSkipped: boolean;
  reminderIssued: boolean;
}): SummaryObligation {
  if (!input.hasRecordedFiles || input.checkpointWritten || input.checkpointSkipped) return 'none';
  return input.reminderIssued ? 'fallback' : 'remind';
}
