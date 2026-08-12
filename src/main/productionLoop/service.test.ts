import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test } from 'vitest';

import {
  ProductionLoopPhase,
  ProductionLoopRecoveryReason,
  ProductionLoopStatus,
  ProductionPlanItemStatus,
} from '../../shared/productionLoop';
import {
  WorkbenchContractKind,
  WorkbenchRunTrigger,
  WorkbenchVerificationOutcome,
} from '../../shared/workbenchTask';
import { HarnessMeasurementService } from '../harness/measurementService';
import { WorkbenchTaskRepository } from '../workbenchTask/repository';
import { initializeWorkbenchTaskSchema } from '../workbenchTask/schema';
import { ProductionLoopRepository } from './repository';
import { initializeProductionLoopSchema } from './schema';
import { MAX_OBSERVED_TOOL_RESULTS, ProductionLoopService } from './service';

let db: Database.Database;
let workbench: WorkbenchTaskRepository;
let service: ProductionLoopService;

beforeEach(() => {
  db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  initializeProductionLoopSchema(db);
  workbench = new WorkbenchTaskRepository(db);
  service = new ProductionLoopService(
    new ProductionLoopRepository(db),
    new HarnessMeasurementService(workbench),
  );
});

afterEach(() => db.close());

const begin = (prototypeRequired = false) => {
  const task = workbench.createTask('session', 'Build a report', {
    kind: WorkbenchContractKind.GenericWork,
    requiresUserAcceptance: true,
  });
  const run = workbench.createRun(task.id, WorkbenchRunTrigger.Message);
  return {
    task,
    run,
    state: service.beginRun({
      taskId: task.id,
      runId: run.id,
      workflowKind: WorkbenchContractKind.GenericWork,
      goal: task.goal,
      prototypeRequired,
    }),
  };
};

const commitPlan = (runId: string) =>
  service.commitPlan(runId, {
    items: [{ title: 'Create artifact' }, { title: 'Run checks' }],
    constraints: ['Stay inside the workspace'],
    acceptanceCriteria: ['Artifact exists', 'Checks pass'],
    expectedArtifacts: [{ kind: 'file', description: 'report.md', required: true }],
    expectedVerifiers: [{ name: 'artifact_verifier', deterministic: true }],
    selectedDirection: 'prototype-a',
  });

const recordVerifier = (runId: string, isError = false) => {
  const toolCallId = `artifact-verifier-${service.repository.get(runId)?.observedToolResults.length ?? 0}`;
  service.recordToolResult(runId, {
    toolCallId,
    toolName: 'bash',
    output: isError ? 'Verifier failed.' : 'report.md exists and is valid.',
    isError,
  });
  return {
    toolCallId,
    evidenceRef: isError
      ? undefined
      : service.getAvailableVerifierEvidence(runId).at(-1)?.evidenceRef,
  };
};

const startInspection = (runId: string) => {
  const { evidenceRef } = recordVerifier(runId);
  if (!evidenceRef) throw new Error('Verifier evidence missing in test setup.');
  return service.startInspection(runId, {
    artifacts: [{ kind: 'file', reference: 'report.md' }],
    verifiers: [{ name: 'artifact_verifier', evidenceRef }],
  });
};

test('requires a prototype only for explicitly high-ambiguity runs', () => {
  const { run, state } = begin(true);
  expect(state.phase).toBe(ProductionLoopPhase.Explore);
  expect(() => commitPlan(run.id)).toThrow('prototype is required');

  service.recordPrototype(run.id, 'prototype-a.html', 'First concrete direction');
  expect(commitPlan(run.id).phase).toBe(ProductionLoopPhase.Execute);
});

test('requires deterministic verifier and artifact evidence before inspection', () => {
  const { run } = begin();
  expect(() =>
    service.commitPlan(run.id, {
      items: [{ title: 'Create artifact' }],
      constraints: [],
      acceptanceCriteria: ['Artifact exists'],
      expectedArtifacts: [],
      expectedVerifiers: [{ name: 'manual review', deterministic: false }],
    }),
  ).toThrow('deterministic verifier');

  const planned = commitPlan(run.id);
  for (const item of planned.planItems) {
    service.updatePlanItem(run.id, item.id, ProductionPlanItemStatus.Completed);
  }
  const successfulEvidence = recordVerifier(run.id);
  if (!successfulEvidence.evidenceRef) throw new Error('Verifier evidence missing in test setup.');
  expect(() =>
    service.startInspection(run.id, {
      artifacts: [],
      verifiers: [{ name: 'artifact_verifier', evidenceRef: successfulEvidence.evidenceRef }],
    }),
  ).toThrow('artifact evidence');
  const failedEvidence = recordVerifier(run.id, true);
  expect(() =>
    service.startInspection(run.id, {
      artifacts: [{ kind: 'file', reference: 'report.md' }],
      verifiers: [
        { name: 'artifact_verifier', evidenceRef: failedEvidence.evidenceRef ?? 'ev-failed' },
      ],
    }),
  ).toThrow('Passing deterministic verifier evidence');

  const inspecting = startInspection(run.id);
  expect(inspecting.inspections).toHaveLength(1);
  expect(inspecting.inspections[0].verifiers[0]).toMatchObject({
    name: 'artifact_verifier',
    toolName: 'bash',
    evidence: 'report.md exists and is valid.',
  });
  expect(inspecting.inspections[0].verifiers[0].toolCallId).toBe(
    service.repository.get(run.id)?.observedToolResults.at(-1)?.toolCallId,
  );
  expect(inspecting.inspections[0].verifiers[0].toolCallId).not.toContain('ev-');
});

test('retains only the latest observed tool results', () => {
  const { run } = begin();

  for (let index = 0; index < MAX_OBSERVED_TOOL_RESULTS + 2; index += 1) {
    service.recordToolResult(run.id, {
      toolCallId: `tool-${index}`,
      toolName: 'bash',
      output: `result-${index}`,
      isError: false,
    });
  }

  const bounded = service.repository.get(run.id)?.observedToolResults ?? [];
  expect(bounded).toHaveLength(MAX_OBSERVED_TOOL_RESULTS);
  expect(bounded[0].toolCallId).toBe('tool-2');
  expect(bounded.at(-1)?.toolCallId).toBe(`tool-${MAX_OBSERVED_TOOL_RESULTS + 1}`);

  service.recordToolResult(run.id, {
    toolCallId: 'tool-2',
    toolName: 'bash',
    output: 'updated-result',
    isError: false,
  });

  const updated = service.repository.get(run.id)?.observedToolResults ?? [];
  expect(updated).toHaveLength(MAX_OBSERVED_TOOL_RESULTS);
  expect(updated[0].toolCallId).toBe('tool-3');
  expect(updated.at(-1)).toMatchObject({
    toolCallId: 'tool-2',
    output: 'updated-result',
  });
  expect(service.getAvailableVerifierEvidence(run.id)).toHaveLength(32);
});

test('persists plan, critic rejection, revision, and delivery readiness', () => {
  const { run } = begin();
  const planned = commitPlan(run.id);
  for (const item of planned.planItems) {
    service.updatePlanItem(run.id, item.id, ProductionPlanItemStatus.Completed);
  }
  const firstEvidence = recordVerifier(run.id);
  if (!firstEvidence.evidenceRef) throw new Error('Verifier evidence missing in test setup.');
  service.startInspection(run.id, {
    artifacts: [{ kind: 'file', reference: 'report.md' }],
    verifiers: [{ name: 'artifact_verifier', evidenceRef: firstEvidence.evidenceRef }],
  });
  service.requestCritique(run.id);
  service.recordCriticStart(run.id, 'review-1');
  const rejected = service.recordCriticResult(
    run.id,
    'review-1',
    JSON.stringify({
      verdict: 'revise',
      findings: [{ severity: 'major', summary: 'Missing test evidence' }],
    }),
    false,
  );
  expect(rejected.phase).toBe(ProductionLoopPhase.Revise);
  expect(rejected.status).toBe(ProductionLoopStatus.NeedsRevision);

  const revision = service.recordRevision(run.id, 'Added test evidence', {
    command: 'npm test',
  });
  expect(revision.revisions[0].progressVersion).toBe(revision.progressVersion);
  expect(revision.observedToolResults).toEqual([]);
  expect(() =>
    service.startInspection(run.id, {
      artifacts: [{ kind: 'file', reference: 'report.md' }],
      verifiers: [
        {
          name: 'artifact_verifier',
          evidenceRef: firstEvidence.evidenceRef,
        },
      ],
    }),
  ).toThrow('Passing deterministic verifier evidence');
  startInspection(run.id);
  service.requestCritique(run.id);
  service.recordCriticStart(run.id, 'review-2');
  const accepted = service.recordCriticResult(
    run.id,
    'review-2',
    JSON.stringify({ verdict: 'pass', findings: [] }),
    false,
  );
  expect(accepted.phase).toBe(ProductionLoopPhase.Deliver);
  expect(accepted.status).toBe(ProductionLoopStatus.ReadyToDeliver);
  expect(service.repository.get(run.id)?.revisions).toHaveLength(1);
  service.recordDeliveryRequest(run.id, 'ready');
  expect(
    service.recordVerificationResult(run.id, WorkbenchVerificationOutcome.Passed, 'passed')?.status,
  ).toBe(ProductionLoopStatus.Completed);
});

test('skip_workflow marks the loop completed and skips the completion gate', () => {
  const { run } = begin();
  const skipped = service.skipWorkflow(run.id, 'Pure information request');
  expect(skipped).toMatchObject({
    status: ProductionLoopStatus.Completed,
    skip: { reason: 'Pure information request' },
  });

  // Verification on a skipped loop is a no-op, not an error.
  expect(
    service.recordVerificationResult(run.id, WorkbenchVerificationOutcome.Failed, 'n/a'),
  ).toMatchObject({ status: ProductionLoopStatus.Completed });
});

test('skip_workflow requires a reason and is only allowed before a plan', () => {
  const { run } = begin();
  expect(() => service.skipWorkflow(run.id, '  ')).toThrow('skip reason');
  commitPlan(run.id);
  expect(() => service.skipWorkflow(run.id, 'too late')).toThrow('before a plan is committed');
});

test('verification on a loop that never reached delivery readiness is a no-op', () => {
  const { run } = begin();
  expect(
    service.recordVerificationResult(run.id, WorkbenchVerificationOutcome.Failed, 'never ready'),
  ).toMatchObject({ status: ProductionLoopStatus.Active });
});

test('accepts a critic verdict wrapped in a Markdown JSON fence', () => {
  const { run } = begin();
  const planned = commitPlan(run.id);
  for (const item of planned.planItems) {
    service.updatePlanItem(run.id, item.id, ProductionPlanItemStatus.Completed);
  }
  startInspection(run.id);
  service.requestCritique(run.id);
  service.recordCriticStart(run.id, 'review');

  const accepted = service.recordCriticResult(
    run.id,
    'review',
    'Review complete.\n```json\n{"verdict":"pass","findings":[]}\n```',
    false,
  );

  expect(accepted.phase).toBe(ProductionLoopPhase.Deliver);
  expect(accepted.status).toBe(ProductionLoopStatus.ReadyToDeliver);
});

test('fails closed when critic output omits required schema fields', () => {
  const { run } = begin();
  const planned = commitPlan(run.id);
  for (const item of planned.planItems) {
    service.updatePlanItem(run.id, item.id, ProductionPlanItemStatus.Completed);
  }
  startInspection(run.id);
  service.requestCritique(run.id);
  service.recordCriticStart(run.id, 'review');

  const rejected = service.recordCriticResult(
    run.id,
    'review',
    JSON.stringify({ verdict: 'pass' }),
    false,
  );
  expect(rejected).toMatchObject({
    phase: ProductionLoopPhase.Revise,
    status: ProductionLoopStatus.NeedsRevision,
    critic: { passed: false },
  });
  expect(rejected.critic.findings[0].summary).toContain('invalid structured response');
});

test('requires a finding for a revise critic verdict', () => {
  const { run } = begin();
  const planned = commitPlan(run.id);
  for (const item of planned.planItems) {
    service.updatePlanItem(run.id, item.id, ProductionPlanItemStatus.Completed);
  }
  startInspection(run.id);
  service.requestCritique(run.id);
  service.recordCriticStart(run.id, 'review');

  const rejected = service.recordCriticResult(
    run.id,
    'review',
    JSON.stringify({ verdict: 'revise', findings: [] }),
    false,
  );
  expect(rejected.critic.findings[0].summary).toContain('invalid structured response');
});

test('deterministic verification failure overrides critic PASS and returns to revision', () => {
  const { run } = begin();
  const planned = commitPlan(run.id);
  for (const item of planned.planItems) {
    service.updatePlanItem(run.id, item.id, ProductionPlanItemStatus.Completed);
  }
  startInspection(run.id);
  service.requestCritique(run.id);
  service.recordCriticStart(run.id, 'review');
  service.recordCriticResult(
    run.id,
    'review',
    JSON.stringify({ verdict: 'pass', findings: [] }),
    false,
  );
  service.recordDeliveryRequest(run.id, 'ready');
  const rejected = service.recordVerificationResult(
    run.id,
    WorkbenchVerificationOutcome.Failed,
    'artifact missing',
  );
  expect(rejected).toMatchObject({
    phase: ProductionLoopPhase.Revise,
    status: ProductionLoopStatus.NeedsRevision,
  });
  expect(rejected?.critic.findings[0].evidence).toBe('artifact missing');
});

test('keeps acceptance-required work ready until the user accepts it', () => {
  const { run } = begin();
  const planned = commitPlan(run.id);
  for (const item of planned.planItems) {
    service.updatePlanItem(run.id, item.id, ProductionPlanItemStatus.Completed);
  }
  startInspection(run.id);
  service.requestCritique(run.id);
  service.recordCriticStart(run.id, 'review');
  service.recordCriticResult(
    run.id,
    'review',
    JSON.stringify({ verdict: 'pass', findings: [] }),
    false,
  );
  service.recordDeliveryRequest(run.id, 'ready');

  const pending = service.recordVerificationResult(
    run.id,
    WorkbenchVerificationOutcome.AcceptanceRequired,
    'User acceptance is required.',
  );

  expect(pending).toMatchObject({
    phase: ProductionLoopPhase.Deliver,
    status: ProductionLoopStatus.ReadyToDeliver,
    deliveryReason: 'ready',
  });
});

test('inherits the durable plan into a new run without replaying prior progress', () => {
  const { task, run } = begin();
  const first = commitPlan(run.id);
  service.updatePlanItem(run.id, first.planItems[0].id, ProductionPlanItemStatus.Completed);
  const retry = workbench.createRun(task.id, WorkbenchRunTrigger.Retry);
  const resumed = service.beginRun({
    taskId: task.id,
    runId: retry.id,
    workflowKind: WorkbenchContractKind.GenericWork,
    goal: task.goal,
    prototypeRequired: false,
  });

  expect(resumed.phase).toBe(ProductionLoopPhase.Plan);
  expect(resumed.acceptanceCriteria).toEqual(first.acceptanceCriteria);
  expect(resumed.planItems.every(item => item.status === ProductionPlanItemStatus.Pending)).toBe(
    true,
  );
  expect(resumed.critic.requested).toBe(false);
  expect(resumed.deliveryReason).toBeNull();
  expect(resumed.revisions).toEqual([]);
  expect(resumed.recoveries).toEqual([]);
  expect(resumed.progressVersion).toBe(0);
});

test('records explicit stale recovery without marking the loop complete', () => {
  const { run } = begin();
  const recovered = service.recordRecovery(
    run.id,
    ProductionLoopRecoveryReason.StaleProgress,
    'No persisted progress changed.',
  );
  expect(recovered.staleCount).toBe(1);
  expect(recovered.status).toBe(ProductionLoopStatus.Active);
  expect(recovered.recoveries[0].reason).toBe(ProductionLoopRecoveryReason.StaleProgress);
});
