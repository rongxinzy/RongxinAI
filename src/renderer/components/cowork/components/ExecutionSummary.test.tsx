// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { expect, test } from 'vitest';

import { getCompletedExecutionSummaryText } from '../helpers/executionStatus';
import { ExecutionSummary } from './ExecutionSummary';

const summary = {
  thinkingSteps: 2,
  toolCalls: 3,
  completedTools: 3,
  failedTools: 0,
  incompleteTools: 0,
};
const label = getCompletedExecutionSummaryText(summary);

test('shimmers the collapsed summary while the turn is still working', () => {
  const { container } = render(<ExecutionSummary summary={summary} persistKey="active" active />);

  // Shimmer paints the label with a background-clip gradient. This row can sit
  // on screen unchanged for a long time, so the running shimmer is what tells a
  // stall apart from a finished turn (issue #133).
  expect(container.querySelector('.bg-clip-text')?.textContent).toBe(label);
});

test('renders the collapsed summary as plain text once the turn is done', () => {
  const { container } = render(<ExecutionSummary summary={summary} persistKey="settled" />);

  expect(container.querySelector('.bg-clip-text')).toBeNull();
  expect(container.textContent).toContain(label);
});
