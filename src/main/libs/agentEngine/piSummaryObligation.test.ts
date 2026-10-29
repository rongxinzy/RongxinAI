import { expect, test } from 'vitest';

import { evaluateSummaryObligation } from './piSummaryObligation';

function input(overrides: Partial<Parameters<typeof evaluateSummaryObligation>[0]> = {}) {
  return {
    hasRecordedFiles: true,
    checkpointWritten: false,
    checkpointSkipped: false,
    workVersion: 1,
    ...overrides,
  };
}

test('no obligation without recorded files or when the outcome covers current work', () => {
  expect(evaluateSummaryObligation(input({ hasRecordedFiles: false }))).toBe('none');
  expect(evaluateSummaryObligation(input({ checkpointWritten: true, coveredWorkVersion: 1 }))).toBe(
    'none',
  );
  expect(evaluateSummaryObligation(input({ checkpointSkipped: true, coveredWorkVersion: 1 }))).toBe(
    'none',
  );
});

test('new work after written or skipped outcomes reactivates deterministic fallback', () => {
  expect(
    evaluateSummaryObligation(
      input({ checkpointWritten: true, coveredWorkVersion: 1, workVersion: 2 }),
    ),
  ).toBe('fallback');
  expect(
    evaluateSummaryObligation(
      input({ checkpointSkipped: true, coveredWorkVersion: 0, workVersion: 1 }),
    ),
  ).toBe('fallback');
});

test('file-producing turn without a checkpoint uses fallback without a reminder', () => {
  expect(evaluateSummaryObligation(input())).toBe('fallback');
});
