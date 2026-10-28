import { expect, test } from 'vitest';

import { evaluateSummaryObligation } from './piSummaryObligation';

test('no obligation without recorded files or when checkpoint is written or skipped', () => {
  expect(
    evaluateSummaryObligation({
      hasRecordedFiles: false,
      checkpointWritten: false,
      checkpointSkipped: false,
    }),
  ).toBe('none');
  expect(
    evaluateSummaryObligation({
      hasRecordedFiles: true,
      checkpointWritten: true,
      checkpointSkipped: false,
    }),
  ).toBe('none');
  expect(
    evaluateSummaryObligation({
      hasRecordedFiles: true,
      checkpointWritten: false,
      checkpointSkipped: true,
    }),
  ).toBe('none');
});

test('file-producing turn without a checkpoint uses fallback without a reminder', () => {
  expect(
    evaluateSummaryObligation({
      hasRecordedFiles: true,
      checkpointWritten: false,
      checkpointSkipped: false,
    }),
  ).toBe('fallback');
});
