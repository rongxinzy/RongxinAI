import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import {
  WORKING_INDICATOR_ELAPSED_THRESHOLD_MS,
  WORKING_INDICATOR_ESCALATION_THRESHOLD_MS,
  WorkingIndicatorPhase,
  getWorkingIndicatorPhase,
} from './WorkingIndicator';

const source = readFileSync(
  fileURLToPath(new URL('./WorkingIndicator.tsx', import.meta.url)),
  'utf8',
);

test('stays in the initial phase before the elapsed threshold', () => {
  expect(getWorkingIndicatorPhase(0)).toBe(WorkingIndicatorPhase.Initial);
  expect(getWorkingIndicatorPhase(WORKING_INDICATOR_ELAPSED_THRESHOLD_MS - 1)).toBe(
    WorkingIndicatorPhase.Initial,
  );
});

test('shows the elapsed ticker once silence crosses the elapsed threshold', () => {
  expect(getWorkingIndicatorPhase(WORKING_INDICATOR_ELAPSED_THRESHOLD_MS)).toBe(
    WorkingIndicatorPhase.Elapsed,
  );
  expect(getWorkingIndicatorPhase(WORKING_INDICATOR_ESCALATION_THRESHOLD_MS - 1)).toBe(
    WorkingIndicatorPhase.Elapsed,
  );
});

test('escalates the copy after a long silence', () => {
  expect(getWorkingIndicatorPhase(WORKING_INDICATOR_ESCALATION_THRESHOLD_MS)).toBe(
    WorkingIndicatorPhase.Escalated,
  );
  expect(getWorkingIndicatorPhase(WORKING_INDICATOR_ESCALATION_THRESHOLD_MS * 4)).toBe(
    WorkingIndicatorPhase.Escalated,
  );
});

test('leaves message-level waiting static while the session run bar owns animation', () => {
  expect(source).toContain('<span className="text-sm text-muted-foreground">{statusText}</span>');
  expect(source).not.toContain('Shimmer');
  expect(source).not.toContain('AgentCompanion');
  expect(source).not.toContain('animate-');
});
