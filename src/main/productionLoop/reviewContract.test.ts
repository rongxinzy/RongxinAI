import { expect, test } from 'vitest';

import { ProductionPlanItemStatus } from '../../shared/productionLoop';
import { PiSubagentToolName } from '../libs/agentEngine/piSubagentConstants';
import { buildProductionReviewContract } from './reviewContract';

const currentResults = Array.from({ length: 15 }, (_, index) => ({
  toolCallId: `current-${index}`,
  toolName: 'bash',
  output:
    index === 14
      ? `apiKey="top-secret-value" ${'x'.repeat(500)}`
      : `verification output ${index}`,
  isError: false,
  progressVersion: 5,
  createdAt: 300 + index,
}));

test('builds a complete bounded contract from the current revision', () => {
  const contract = buildProductionReviewContract({
    goal: 'Ship the verified implementation without exposing Bearer abcdefghijklmnop',
    constraints: ['password=do-not-share', 'Keep the public API stable.'],
    acceptanceCriteria: ['All deterministic checks pass.'],
    expectedArtifacts: [
      { kind: 'report', description: 'A final verification report.', required: true },
    ],
    expectedVerifiers: [{ name: 'unit tests', deterministic: true }],
    planItems: [
      {
        id: 'item-1',
        title: 'Implement and verify',
        status: ProductionPlanItemStatus.Completed,
        detail: 'Internal detail is intentionally omitted.',
      },
    ],
    inspections: [
      {
        artifacts: [{ kind: 'report', reference: 'output/report.md' }],
        verifiers: [
          {
            name: 'unit tests',
            toolCallId: 'current-14',
            toolName: 'bash',
            evidence: 'Authorization: Bearer verifier-secret tests passed',
          },
        ],
        createdAt: 500,
      },
    ],
    revisions: [
      {
        summary: 'Addressed the first review.',
        evidence: {},
        createdAt: 200,
        progressVersion: 5,
      },
    ],
    observedToolResults: [
      {
        toolCallId: 'old-result',
        toolName: 'bash',
        output: 'stale evidence',
        isError: false,
        progressVersion: 4,
        createdAt: 100,
      },
      ...currentResults,
      {
        toolCallId: 'previous-reviewer',
        toolName: PiSubagentToolName,
        output: '{"verdict":"revise","findings":[]}',
        isError: false,
        progressVersion: 6,
        createdAt: 600,
      },
    ],
  });

  expect(contract).toMatchObject({
    constraints: ['password=[REDACTED]', 'Keep the public API stable.'],
    acceptanceCriteria: ['All deterministic checks pass.'],
    artifacts: [
      { kind: 'report', description: 'A final verification report.', required: true },
    ],
    verifiers: [{ name: 'unit tests', deterministic: true }],
    plan: [{ status: ProductionPlanItemStatus.Completed, title: 'Implement and verify' }],
    inspection: {
      artifacts: [{ kind: 'report', reference: 'output/report.md' }],
      verifiers: [
        {
          name: 'unit tests',
          toolName: 'bash',
          toolCallId: 'current-14',
          evidence: 'Authorization: [REDACTED] tests passed',
        },
      ],
    },
  });
  expect(contract.goal).toBe(
    'Ship the verified implementation without exposing Bearer [REDACTED]',
  );
  expect(contract.observedExecution).toHaveLength(12);
  expect(contract.observedExecution[0].toolCallId).toBe('current-3');
  const latestObserved = contract.observedExecution[contract.observedExecution.length - 1];
  expect(latestObserved.toolCallId).toBe('current-14');
  expect(latestObserved.outputSummary).toContain('apiKey=[REDACTED]');
  expect(latestObserved.outputSummary.length).toBeLessThanOrEqual(320);
  expect(JSON.stringify(contract)).not.toContain('top-secret-value');
  expect(JSON.stringify(contract)).not.toContain('stale evidence');
  expect(JSON.stringify(contract)).not.toContain('previous-reviewer');
});

test('uses revision timestamps for persisted states without progress metadata', () => {
  const contract = buildProductionReviewContract({
    goal: 'Verify',
    constraints: [],
    acceptanceCriteria: [],
    expectedArtifacts: [],
    expectedVerifiers: [],
    planItems: [],
    inspections: [],
    revisions: [{ summary: 'legacy', evidence: {}, createdAt: 200 }],
    observedToolResults: [
      {
        toolCallId: 'old',
        toolName: 'read',
        output: 'old',
        isError: false,
        progressVersion: 1,
        createdAt: 199,
      },
      {
        toolCallId: 'new',
        toolName: 'read',
        output: 'new',
        isError: false,
        progressVersion: 1,
        createdAt: 201,
      },
    ],
  });

  expect(contract.observedExecution.map(result => result.toolCallId)).toEqual(['new']);
});
