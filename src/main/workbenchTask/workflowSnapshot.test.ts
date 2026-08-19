import { expect, test } from 'vitest';

import { composeWorkbenchWorkflowSnapshot } from './workflowSnapshot';

test('keeps domain completion failures and files under the production controller', () => {
  const domain = {
    phase: 'domain-complete',
    completionFailures: ['Preview is missing'],
    files: [{ path: 'output/report.md' }],
    artifacts: [{ path: 'output/validation.json' }],
  };
  const production = { phase: 'deliver', status: 'ready_to_deliver', skipped: false };

  expect(composeWorkbenchWorkflowSnapshot({ production, domain })).toEqual({
    ...production,
    domainWorkflow: domain,
    completionFailures: ['Preview is missing'],
    files: [{ path: 'output/report.md' }],
    artifacts: [{ path: 'output/validation.json' }],
  });
});

test('returns the available snapshot without introducing a wrapper', () => {
  const production = { phase: 'deliver' };
  const domain = { completionFailures: [] };

  expect(composeWorkbenchWorkflowSnapshot({ production })).toBe(production);
  expect(composeWorkbenchWorkflowSnapshot({ domain })).toBe(domain);
  expect(composeWorkbenchWorkflowSnapshot({})).toBeNull();
});
