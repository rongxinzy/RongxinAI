import { expect, test } from 'vitest';

import { WorkbenchApprovalRiskLevel } from '../../shared/workbenchTask';
import { classifyWorkbenchToolRisk, createToolIdempotencyKey } from './riskClassifier';

test('classifies known reads, reversible writes, and destructive shell commands', () => {
  expect(classifyWorkbenchToolRisk('read', { path: 'README.md' })).toBe(
    WorkbenchApprovalRiskLevel.ReadOnly,
  );
  expect(classifyWorkbenchToolRisk('write', { path: 'out.txt' })).toBe(
    WorkbenchApprovalRiskLevel.Reversible,
  );
  expect(classifyWorkbenchToolRisk('bash', { command: 'git reset --hard HEAD' })).toBe(
    WorkbenchApprovalRiskLevel.Irreversible,
  );
  expect(classifyWorkbenchToolRisk('mcp_proxy', {})).toBe(WorkbenchApprovalRiskLevel.Unknown);
  expect(classifyWorkbenchToolRisk('subagent', {})).toBe(WorkbenchApprovalRiskLevel.Unknown);
});

test('idempotency hashing is stable across object key order', () => {
  expect(createToolIdempotencyKey('run', 'call', { a: 1, b: 2 })).toBe(
    createToolIdempotencyKey('run', 'call', { b: 2, a: 1 }),
  );
});
