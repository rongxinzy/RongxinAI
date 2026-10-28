import { expect, test } from 'vitest';

import { evaluateSummaryObligation } from './piSummaryObligation';

test('no obligation without recorded files or when checkpoint is written or skipped', () => {
  expect(
    evaluateSummaryObligation({
      hasRecordedFiles: false,
      checkpointWritten: false,
      checkpointSkipped: false,
      reminderIssued: false,
    }),
  ).toBe('none');
  expect(
    evaluateSummaryObligation({
      hasRecordedFiles: true,
      checkpointWritten: true,
      checkpointSkipped: false,
      reminderIssued: false,
    }),
  ).toBe('none');
  expect(
    evaluateSummaryObligation({
      hasRecordedFiles: true,
      checkpointWritten: false,
      checkpointSkipped: true,
      reminderIssued: false,
    }),
  ).toBe('none');
});

test('file-producing turn without a checkpoint gets exactly one reminder, then fallback', () => {
  expect(
    evaluateSummaryObligation({
      hasRecordedFiles: true,
      checkpointWritten: false,
      checkpointSkipped: false,
      reminderIssued: false,
    }),
  ).toBe('remind');
  expect(
    evaluateSummaryObligation({
      hasRecordedFiles: true,
      checkpointWritten: false,
      checkpointSkipped: false,
      reminderIssued: true,
    }),
  ).toBe('fallback');
});
