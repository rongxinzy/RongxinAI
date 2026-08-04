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
import { ProductionLoopService } from './service';

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

test('requires a prototype only for explicitly high-ambiguity runs', () => {
  const { run, state } = begin(true);
  expect(state.phase).toBe(ProductionLoopPhase.Explore);
  expect(() => commitPlan(run.id)).toThrow('prototype is required');

  service.recordPrototype(run.id, 'prototype-a.html', 'First concrete direction');
  expect(commitPlan(run.id).phase).toBe(ProductionLoopPhase.Execute);
});

test('persists plan, critic rejection, revision, and delivery readiness', () => {
  const { run } = begin();
  const planned = commitPlan(run.id);
  for (const item of planned.planItems) {
    service.updatePlanItem(run.id, item.id, ProductionPlanItemStatus.Completed);
  }
  service.startInspection(run.id);
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

  service.recordRevision(run.id, 'Added test evidence', { command: 'npm test' });
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

test('accepts a critic verdict wrapped in a Markdown JSON fence', () => {
  const { run } = begin();
  const planned = commitPlan(run.id);
  for (const item of planned.planItems) {
    service.updatePlanItem(run.id, item.id, ProductionPlanItemStatus.Completed);
  }
  service.startInspection(run.id);
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

test('deterministic verification failure overrides critic PASS and returns to revision', () => {
  const { run } = begin();
  const planned = commitPlan(run.id);
  for (const item of planned.planItems) {
    service.updatePlanItem(run.id, item.id, ProductionPlanItemStatus.Completed);
  }
  service.startInspection(run.id);
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
  service.startInspection(run.id);
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
