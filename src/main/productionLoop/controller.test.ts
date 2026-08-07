import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ProductionLoopPhase, ProductionLoopStatus } from '../../shared/productionLoop';
import {
  WorkbenchContractKind,
  WorkbenchRunTrigger,
  WorkbenchVerificationOutcome,
} from '../../shared/workbenchTask';
import { HarnessMeasurementService } from '../harness/measurementService';
import { PiSubagentProfileId } from '../libs/agentEngine/piSubagentConstants';
import { WorkbenchTaskRepository } from '../workbenchTask/repository';
import { initializeWorkbenchTaskSchema } from '../workbenchTask/schema';
import { ProductionLoopController } from './controller';
import { ProductionLoopRepository } from './repository';
import { initializeProductionLoopSchema } from './schema';
import { ProductionLoopService } from './service';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  initializeProductionLoopSchema(db);
});

afterEach(() => db.close());

const createController = () => {
  const workbench = new WorkbenchTaskRepository(db);
  const task = workbench.createTask('session', 'Build', {
    kind: WorkbenchContractKind.Shortcut,
    requiresUserAcceptance: false,
  });
  const run = workbench.createRun(task.id, WorkbenchRunTrigger.Message);
  const service = new ProductionLoopService(
    new ProductionLoopRepository(db),
    new HarnessMeasurementService(workbench),
  );
  const downstream = {
    goal: 'Verified shortcut',
    requestCompletion: vi.fn(() => 'downstream requested'),
    onAgentEnd: vi.fn(() => ({ shouldFinish: true, reason: 'downstream passed' })),
  };
  return {
    controller: new ProductionLoopController(
      service,
      {
        taskId: task.id,
        runId: run.id,
        workflowKind: WorkbenchContractKind.Shortcut,
        goal: task.goal,
        prototypeRequired: false,
      },
      downstream,
    ),
    service,
    downstream,
  };
};

const reachCritique = (controller: ProductionLoopController) => {
  const planned = controller.commitPlan({
    items: [{ title: 'Build' }],
    constraints: [],
    acceptanceCriteria: ['Preview passes'],
    expectedArtifacts: [],
    expectedVerifiers: [{ name: 'preview', deterministic: true }],
  });
  for (const item of planned.planItems) {
    controller.updatePlanItem(item.id, 'completed');
  }
  controller.recordToolResult('preview-check', 'bash', 'Preview completed successfully.', false);
  controller.startInspection({
    artifacts: [],
    verifiers: [{ name: 'preview', toolCallId: 'preview-check' }],
  });
  controller.requestCritique();
};

test('blocks premature finalization and returns a recovery prompt', () => {
  const { controller, downstream } = createController();
  expect(controller.requestCompletion('done')).toContain('Completion blocked');
  expect(downstream.requestCompletion).not.toHaveBeenCalled();
  expect(controller.onAgentEnd({ next: false })).toMatchObject({ shouldFinish: false });
});

test('a normal agent_loop next continues without recording a recovery', () => {
  const { controller } = createController();
  const before = controller.getState().recoveries.length;
  const decision = controller.onAgentEnd({ next: true, summary: 'drafted the outline' });
  expect(decision.shouldFinish).toBe(false);
  expect(decision.nextPrompt).toContain('ended normally');
  expect(decision.nextPrompt).toContain('drafted the outline');
  // No recovery is recorded for an explicit, orderly iteration end.
  expect(controller.getState().recoveries.length).toBe(before);
});

test('an omitted agent_loop signal records a missing-signal recovery', () => {
  const { controller } = createController();
  const before = controller.getState().recoveries.length;
  const decision = controller.onAgentEnd({ next: false });
  expect(decision.shouldFinish).toBe(false);
  expect(decision.nextPrompt).toContain('ended before delivery');
  expect(controller.getState().recoveries.length).toBe(before + 1);
});

test('accepts only the requested read-only reviewer result before delivery', () => {
  const { controller, downstream } = createController();
  reachCritique(controller);
  controller.recordSubagentStart('scout', { agent: 'scout', task: 'review' });
  expect(controller.getState().critic.toolCallId).toBeNull();
  controller.recordSubagentStart('review', {
    agent: PiSubagentProfileId.ProductionReviewer,
    task: 'review',
  });
  controller.recordSubagentResult(
    'review',
    JSON.stringify({ verdict: 'pass', findings: [] }),
    false,
  );
  expect(controller.getState()).toMatchObject({
    phase: ProductionLoopPhase.Deliver,
    status: ProductionLoopStatus.ReadyToDeliver,
  });

  expect(controller.requestCompletion('ready')).toBe('downstream requested');
  expect(controller.onAgentEnd({ next: false })).toEqual({ shouldFinish: true, reason: 'ready' });
  expect(downstream.onAgentEnd).toHaveBeenCalledOnce();
  expect(controller.getState().status).toBe(ProductionLoopStatus.ReadyToDeliver);
});

test('invalid critic output enters revision instead of silently passing', () => {
  const { controller } = createController();
  reachCritique(controller);
  controller.recordSubagentStart('review', {
    agent: PiSubagentProfileId.ProductionReviewer,
    task: 'review',
  });
  controller.recordSubagentResult('review', 'looks fine', false);
  expect(controller.getState().phase).toBe(ProductionLoopPhase.Revise);
  expect(controller.getState().critic.findings[0].summary).toContain('invalid structured response');
});

test('does not bind grouped subagent calls as the independent reviewer', () => {
  const { controller } = createController();
  reachCritique(controller);
  controller.recordSubagentStart('parallel-review', {
    parallel: [
      { agent: PiSubagentProfileId.ProductionReviewer, task: 'review' },
      { agent: 'scout', task: 'inspect files' },
    ],
  });
  expect(controller.getState().critic.toolCallId).toBeNull();

  controller.recordSubagentStart('standalone-review', {
    agent: PiSubagentProfileId.ProductionReviewer,
    task: 'review',
  });
  expect(controller.getState().critic.toolCallId).toBe('standalone-review');
});

test('refreshes externally persisted verification state before making decisions', () => {
  const { controller, service } = createController();
  reachCritique(controller);
  controller.recordSubagentStart('review', {
    agent: PiSubagentProfileId.ProductionReviewer,
    task: 'review',
  });
  controller.recordSubagentResult(
    'review',
    JSON.stringify({ verdict: 'pass', findings: [] }),
    false,
  );
  controller.requestCompletion('ready');
  const runId = controller.getState().runId;

  service.recordVerificationResult(runId, WorkbenchVerificationOutcome.Failed, 'checks failed');

  expect(controller.getState()).toMatchObject({
    phase: ProductionLoopPhase.Revise,
    status: ProductionLoopStatus.NeedsRevision,
  });
  expect(controller.onAgentEnd({ next: false })).toMatchObject({
    shouldFinish: false,
  });
});

test('skip_workflow lets the agent finish without the completion gate', () => {
  const { controller, downstream } = createController();
  controller.skipWorkflow('Pure information request with no work to plan');
  expect(controller.getState()).toMatchObject({
    phase: ProductionLoopPhase.Plan,
    status: ProductionLoopStatus.Completed,
    skip: { reason: 'Pure information request with no work to plan' },
  });

  // Completion is no longer blocked.
  expect(controller.requestCompletion('answered')).toBe('downstream requested');
  expect(downstream.requestCompletion).toHaveBeenCalledOnce();

  // Agent end finishes without a recovery prompt.
  expect(controller.onAgentEnd({ next: false })).toEqual({
    shouldFinish: true,
    reason: 'Pure information request with no work to plan',
  });
  expect(downstream.onAgentEnd).not.toHaveBeenCalled();
});

test('skip_workflow is rejected after a plan is committed', () => {
  const { controller } = createController();
  reachCritique(controller);
  expect(() => controller.skipWorkflow('too late')).toThrow('before a plan is committed');
});
