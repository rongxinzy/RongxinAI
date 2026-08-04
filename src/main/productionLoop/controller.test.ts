import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ProductionLoopPhase, ProductionLoopStatus } from '../../shared/productionLoop';
import { WorkbenchContractKind, WorkbenchRunTrigger } from '../../shared/workbenchTask';
import { HarnessMeasurementService } from '../harness/measurementService';
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
  controller.startInspection();
  controller.requestCritique();
};

test('blocks premature finalization and returns a recovery prompt', () => {
  const { controller, downstream } = createController();
  expect(controller.requestCompletion('done')).toContain('Completion blocked');
  expect(downstream.requestCompletion).not.toHaveBeenCalled();
  expect(controller.onAgentEnd()).toMatchObject({ shouldFinish: false });
});

test('accepts only the requested read-only reviewer result before delivery', () => {
  const { controller, downstream } = createController();
  reachCritique(controller);
  controller.recordSubagentStart('scout', { agent: 'scout', task: 'review' });
  expect(controller.getState().critic.toolCallId).toBeNull();
  controller.recordSubagentStart('review', { agent: 'reviewer', task: 'review' });
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
  expect(controller.onAgentEnd()).toEqual({ shouldFinish: true, reason: 'ready' });
  expect(downstream.onAgentEnd).toHaveBeenCalledOnce();
  expect(controller.getState().status).toBe(ProductionLoopStatus.ReadyToDeliver);
});

test('invalid critic output enters revision instead of silently passing', () => {
  const { controller } = createController();
  reachCritique(controller);
  controller.recordSubagentStart('review', { agent: 'reviewer', task: 'review' });
  controller.recordSubagentResult('review', 'looks fine', false);
  expect(controller.getState().phase).toBe(ProductionLoopPhase.Revise);
  expect(controller.getState().critic.findings[0].summary).toContain('invalid structured response');
});
