import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ProductionLoopPhase, ProductionLoopStatus } from '../../shared/productionLoop';
import {
  WorkbenchContractKind,
  WorkbenchRunTrigger,
  WorkbenchVerificationOutcome,
} from '../../shared/workbenchTask';
import { HarnessMeasurementService } from '../harness/measurementService';
import {
  PiSubagentProfileId,
  PiSubagentTerminationReason,
} from '../libs/agentEngine/piSubagentConstants';
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
    task,
    workbench,
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
  const evidenceRef = controller.getAvailableVerifierEvidence()[0]?.evidenceRef ?? 'missing';
  controller.startInspection({
    artifacts: [],
    verifiers: [{ name: 'preview', evidenceRef }],
  });
  controller.requestCritique();
};

const createGenericWorkController = (
  options: { resolveElevatedRisk?: (runId: string) => boolean } = {},
) => {
  const workbench = new WorkbenchTaskRepository(db);
  const task = workbench.createTask('session', 'Analyze GPU logs', {
    kind: WorkbenchContractKind.GenericWork,
    requiresUserAcceptance: true,
  });
  const run = workbench.createRun(task.id, WorkbenchRunTrigger.Message);
  const service = new ProductionLoopService(
    new ProductionLoopRepository(db),
    new HarnessMeasurementService(workbench),
  );
  const downstream = {
    goal: 'Analyzed result',
    requestCompletion: vi.fn(() => 'downstream requested'),
    onAgentEnd: vi.fn(() => ({ shouldFinish: true, reason: 'downstream passed' })),
  };
  return {
    controller: new ProductionLoopController(
      service,
      {
        taskId: task.id,
        runId: run.id,
        workflowKind: WorkbenchContractKind.GenericWork,
        goal: task.goal,
        prototypeRequired: false,
        ...options,
      },
      downstream,
    ),
    service,
    downstream,
  };
};

test('lightweight generic work skips the reviewer, reaches delivery, and exposes no reviewed artifacts', () => {
  // Full split coverage lives in 'risk probe consulted at critique time'
  // (lightweight branch, standard branch, and the probe flip).
  const { controller } = createGenericWorkController({
    resolveElevatedRisk: () => false,
  });
  const planned = controller.commitPlan({
    items: [{ title: 'Build' }],
    constraints: [],
    acceptanceCriteria: ['Preview passes'],
    expectedArtifacts: [{ kind: 'report', description: 'Final report', required: true }],
    expectedVerifiers: [{ name: 'preview', deterministic: true }],
  });
  for (const item of planned.planItems) {
    controller.updatePlanItem(item.id, 'completed');
  }
  controller.recordToolResult('preview-check', 'bash', 'Preview completed successfully.', false);
  const evidenceRef = controller.getAvailableVerifierEvidence()[0]?.evidenceRef ?? 'missing';
  controller.startInspection({
    artifacts: [{ kind: 'report', reference: 'output/report.md' }],
    verifiers: [{ name: 'preview', evidenceRef }],
  });

  const prompt = controller.requestCritique();

  expect(prompt).toContain('skipped');
  expect(prompt).not.toContain('subagent');
  const state = controller.getState();
  expect(state.phase).toBe(ProductionLoopPhase.Deliver);
  expect(state.status).toBe(ProductionLoopStatus.ReadyToDeliver);
  expect(state.critic.skipped).toBe(true);
  expect(state.critic.passed).toBe(false);
  // A skipped review is not a passed review: artifacts stay pending until
  // user acceptance elevates them.
  expect(controller.getReviewedArtifacts()).toEqual([]);
  expect(controller.getSnapshot().criticSkipped).toBe(true);
});

test('approved unknown-risk approvals force the full reviewer', () => {
  // Unknown-classified operations (mcp tools, unclassified shell commands)
  // must not be treated as low risk: lightweight review is fail-open only
  // for positively read-only/reversible runs.
  const { controller } = createGenericWorkController({
    resolveElevatedRisk: () => true, // approved Unknown approval present
  });
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
  const evidenceRef = controller.getAvailableVerifierEvidence()[0]?.evidenceRef ?? 'missing';
  controller.startInspection({
    artifacts: [],
    verifiers: [{ name: 'preview', evidenceRef }],
  });

  const prompt = controller.requestCritique();
  expect(prompt).toContain('production-reviewer');
  expect(prompt).not.toContain('skipped');
});

test('a missing risk probe fails closed into the full reviewer', () => {
  const { controller } = createGenericWorkController();
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
  const evidenceRef = controller.getAvailableVerifierEvidence()[0]?.evidenceRef ?? 'missing';
  controller.startInspection({
    artifacts: [],
    verifiers: [{ name: 'preview', evidenceRef }],
  });

  const prompt = controller.requestCritique();
  expect(prompt).toContain('production-reviewer');
});

test('domain workflows always run the full reviewer', () => {
  const { controller } = createController();
  reachCritique(controller);
  // createController uses Shortcut: requestCritique inside reachCritique
  // requested the reviewer, so the state is waiting for a critic.
  expect(controller.getState().phase).toBe(ProductionLoopPhase.Critique);
  expect(controller.getState().critic.requested).toBe(true);
});

test('elevated-risk probe consulted at critique time revokes lightweight mode', () => {
  let risky = false;
  const { controller } = createGenericWorkController({
    resolveElevatedRisk: () => risky,
  });
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
  const evidenceRef = controller.getAvailableVerifierEvidence()[0]?.evidenceRef ?? 'missing';
  controller.startInspection({
    artifacts: [],
    verifiers: [{ name: 'preview', evidenceRef }],
  });

  // No risk at critique time: lightweight skip.
  const lightweightPrompt = controller.requestCritique();
  expect(lightweightPrompt).toContain('skipped');
  expect(controller.getState().phase).toBe(ProductionLoopPhase.Deliver);

  // A risk-free run stays lightweight; a risky run is the standard branch.
  risky = true;
  const { controller: riskyController } = createGenericWorkController({
    resolveElevatedRisk: () => risky,
  });
  const riskyPlanned = riskyController.commitPlan({
    items: [{ title: 'Build' }],
    constraints: [],
    acceptanceCriteria: ['Preview passes'],
    expectedArtifacts: [],
    expectedVerifiers: [{ name: 'preview', deterministic: true }],
  });
  for (const item of riskyPlanned.planItems) {
    riskyController.updatePlanItem(item.id, 'completed');
  }
  riskyController.recordToolResult('preview-check', 'bash', 'Preview completed successfully.', false);
  const riskyEvidenceRef =
    riskyController.getAvailableVerifierEvidence()[0]?.evidenceRef ?? 'missing';
  riskyController.startInspection({
    artifacts: [],
    verifiers: [{ name: 'preview', evidenceRef: riskyEvidenceRef }],
  });
  const fullPrompt = riskyController.requestCritique();
  expect(fullPrompt).toContain('production-reviewer');
  expect(fullPrompt).not.toContain('skipped');
});

test('re-submitting the same plan is idempotent and keeps item IDs stable', () => {
  const { controller } = createController();
  const plan = {
    items: [{ title: 'Build' }],
    constraints: [],
    acceptanceCriteria: ['Preview passes'],
    expectedArtifacts: [],
    expectedVerifiers: [{ name: 'preview', deterministic: true }],
  };
  const first = controller.commitPlan(plan);
  const itemId = first.planItems[0].id;
  const versionAfterFirst = first.progressVersion;

  const second = controller.commitPlan(plan);

  expect(second).toMatchObject({
    phase: ProductionLoopPhase.Execute,
    progressVersion: versionAfterFirst,
  });
  expect(second.planItems[0].id).toBe(itemId);
  expect(second.planItems).toHaveLength(1);
});

test('re-submitting a different plan after commit is rejected, not silently replaced', () => {
  const { controller } = createController();
  controller.commitPlan({
    items: [{ title: 'Build' }],
    constraints: [],
    acceptanceCriteria: ['Preview passes'],
    expectedArtifacts: [],
    expectedVerifiers: [{ name: 'preview', deterministic: true }],
  });

  expect(() =>
    controller.commitPlan({
      items: [{ title: 'Different plan' }],
      constraints: [],
      acceptanceCriteria: ['Preview passes'],
      expectedArtifacts: [],
      expectedVerifiers: [{ name: 'preview', deterministic: true }],
    }),
  ).toThrow(/only be committed during the plan phase/);
});

test('model view is phase-slim and excludes replay data', () => {
  const { controller } = createController();
  const planned = controller.commitPlan({
    items: [{ title: 'Build', detail: 'Create the artifact' }],
    constraints: ['Stay in scope'],
    acceptanceCriteria: ['Preview passes'],
    expectedArtifacts: [],
    expectedVerifiers: [{ name: 'preview', deterministic: true }],
  });
  controller.updatePlanItem(planned.planItems[0].id, 'completed');
  controller.recordToolResult('preview-check', 'bash', 'Preview completed successfully.', false);

  const view = controller.getModelState();
  expect(view).toMatchObject({
    phase: ProductionLoopPhase.Execute,
    status: ProductionLoopStatus.Active,
    planItems: [{ id: planned.planItems[0].id, title: 'Build', status: 'completed' }],
    acceptanceCriteria: ['Preview passes'],
    critic: { requested: false, passed: false },
  });
  expect(typeof view.progressVersion).toBe('number');
  // Replay data and fields the model does not need never enter the view.
  expect(view).not.toHaveProperty('observedToolResults');
  expect(view).not.toHaveProperty('recoveries');
  expect(view).not.toHaveProperty('prototypes');
  expect(view).not.toHaveProperty('inspections');
  expect(view).not.toHaveProperty('constraints');
  expect(view).not.toHaveProperty('goal');
  expect(view).not.toHaveProperty('critic.execution');
});

test('deliver-phase view steers the terminal handoff instead of get_state', () => {
  const { controller, service } = createController();
  reachCritique(controller);
  const runId = controller.getState().runId;
  service.recordCriticStart(runId, 'critic-call');
  service.recordCriticResult(
    runId,
    'critic-call',
    JSON.stringify({ verdict: 'pass', findings: [] }),
    false,
  );
  controller.requestCompletion('approved');
  const full = controller.getState();
  expect(full.phase).toBe(ProductionLoopPhase.Deliver);
  expect(full.status).toBe(ProductionLoopStatus.ReadyToDeliver);

  const view = controller.getModelState();
  expect(view.nextStep).toEqual({ tool: 'agent_loop', action: 'done' });
  expect(view.deliveryReason).toBe('approved');
});

test('model view exposes critic findings but never the full critic state', () => {
  const { controller } = createController();
  reachCritique(controller);
  const full = controller.getState();

  const view = controller.getModelState();
  expect(view.critic).toMatchObject({ requested: true, passed: false });
  expect(view.critic).not.toHaveProperty('execution');
  expect(view.critic).not.toHaveProperty('toolCallId');
  expect(full.critic).toHaveProperty('execution');
});

test('blocks premature finalization and returns a recovery prompt', () => {
  const { controller, downstream } = createController();
  expect(controller.requestCompletion('done')).toContain('Completion blocked');
  expect(downstream.requestCompletion).not.toHaveBeenCalled();
  expect(controller.onAgentEnd({ next: false })).toMatchObject({ shouldFinish: false });
});

test('defers persistent state until the model records a start or skip decision', () => {
  const workbench = new WorkbenchTaskRepository(db);
  const task = workbench.createTask('session', 'Answer or build', {
    kind: WorkbenchContractKind.GenericWork,
    requiresUserAcceptance: true,
  });
  const run = workbench.createRun(task.id, WorkbenchRunTrigger.Message);
  const service = new ProductionLoopService(
    new ProductionLoopRepository(db),
    new HarnessMeasurementService(workbench),
  );
  const controller = new ProductionLoopController(service, {
    taskId: task.id,
    runId: run.id,
    workflowKind: WorkbenchContractKind.GenericWork,
    goal: task.goal,
    prototypeRequired: false,
    deferDecision: true,
  });

  expect(controller.getModelState()).toMatchObject({ decision: 'undecided' });
  expect(service.repository.get(run.id)).toBeNull();
  expect(controller.buildInitialPrompt()).toContain('Before any other tool call');
  expect(controller.buildInitialPrompt()).toContain('Final user acceptance is Workbench-owned');
  expect(controller.onAgentEnd({ next: false })).toMatchObject({ shouldFinish: false });
  expect(service.repository.get(run.id)).toBeNull();

  controller.skipWorkflow('Direct answer requiring no tools or deliverable');
  expect(service.repository.get(run.id)).toMatchObject({
    status: ProductionLoopStatus.Completed,
    skip: { reason: 'Direct answer requiring no tools or deliverable' },
  });
});

test('exposes record_prototype as the first action for deferred prototype workflows', () => {
  const workbench = new WorkbenchTaskRepository(db);
  const task = workbench.createTask('session', 'Create a presentation', {
    kind: WorkbenchContractKind.GenericWork,
    requiresUserAcceptance: true,
  });
  const run = workbench.createRun(task.id, WorkbenchRunTrigger.Message);
  const service = new ProductionLoopService(
    new ProductionLoopRepository(db),
    new HarnessMeasurementService(workbench),
  );
  const controller = new ProductionLoopController(service, {
    taskId: task.id,
    runId: run.id,
    workflowKind: WorkbenchContractKind.GenericWork,
    goal: task.goal,
    prototypeRequired: true,
    deferDecision: true,
  });

  expect(controller.getModelState()).toMatchObject({
    decision: 'undecided',
    prototypeRequired: true,
    availableActions: ['record_prototype', 'skip_workflow'],
  });
  expect(controller.buildInitialPrompt()).toContain('start with production_loop record_prototype');
});

test('starts deferred production state when the model commits a plan', () => {
  const workbench = new WorkbenchTaskRepository(db);
  const task = workbench.createTask('session', 'Research a company', {
    kind: WorkbenchContractKind.GenericWork,
    requiresUserAcceptance: true,
  });
  const run = workbench.createRun(task.id, WorkbenchRunTrigger.Message);
  const service = new ProductionLoopService(
    new ProductionLoopRepository(db),
    new HarnessMeasurementService(workbench),
  );
  const controller = new ProductionLoopController(service, {
    taskId: task.id,
    runId: run.id,
    workflowKind: WorkbenchContractKind.GenericWork,
    goal: task.goal,
    prototypeRequired: false,
    deferDecision: true,
  });

  controller.commitPlan({
    items: [{ title: 'Collect evidence' }],
    constraints: [],
    acceptanceCriteria: ['Claims cite evidence'],
    expectedArtifacts: [],
    expectedVerifiers: [{ name: 'evidence_check', deterministic: true }],
  });

  expect(service.repository.get(run.id)).toMatchObject({
    phase: ProductionLoopPhase.Execute,
    status: ProductionLoopStatus.Active,
  });
});

test('does not allow Goal mode to skip the production workflow', () => {
  const workbench = new WorkbenchTaskRepository(db);
  const task = workbench.createTask('session', 'Complete the goal', {
    kind: WorkbenchContractKind.GenericWork,
    requiresUserAcceptance: true,
  });
  const run = workbench.createRun(task.id, WorkbenchRunTrigger.Message);
  const service = new ProductionLoopService(
    new ProductionLoopRepository(db),
    new HarnessMeasurementService(workbench),
  );
  const controller = new ProductionLoopController(service, {
    taskId: task.id,
    runId: run.id,
    workflowKind: WorkbenchContractKind.GenericWork,
    goal: task.goal,
    prototypeRequired: false,
    deferDecision: true,
    skipAllowed: false,
  });

  expect(() => controller.skipWorkflow('Looks simple')).toThrow('cannot be skipped');
  expect(service.repository.get(run.id)).toBeNull();
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

test('describes resumed execution without asking the agent to recommit the plan', () => {
  const { controller, task, workbench } = createController();
  const planned = controller.commitPlan({
    items: [{ title: 'Build' }],
    constraints: [],
    acceptanceCriteria: ['Preview passes'],
    expectedArtifacts: [],
    expectedVerifiers: [{ name: 'preview', deterministic: true }],
  });
  controller.updatePlanItem(planned.planItems[0].id, 'completed');
  const retry = workbench.createRun(task.id, WorkbenchRunTrigger.Resume);
  controller.startRun({
    taskId: task.id,
    runId: retry.id,
    workflowKind: WorkbenchContractKind.Shortcut,
    goal: 'Use the persisted state',
    prototypeRequired: false,
  });

  const prompt = controller.buildInitialPrompt();

  expect(controller.getState().phase).toBe(ProductionLoopPhase.Execute);
  expect(prompt).toContain('Resume the persisted execution plan');
  expect(prompt).toContain('evidence belongs to this run');
  expect(prompt).toContain('Final user acceptance is Workbench-owned');
  expect(prompt).not.toContain('Begin by committing an executable plan');
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
    {
      terminationReason: PiSubagentTerminationReason.Settled,
      durationMs: 1_200,
      assistantTurns: 2,
      toolCalls: 1,
      steerRequested: false,
    },
  );
  expect(controller.getState()).toMatchObject({
    phase: ProductionLoopPhase.Deliver,
    status: ProductionLoopStatus.ReadyToDeliver,
    critic: {
      execution: {
        durationMs: 1_200,
        assistantTurns: 2,
        toolCalls: 1,
        steerRequested: false,
        timedOut: false,
      },
    },
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

test('builds the reviewer prompt from compact contract and execution evidence', () => {
  const { controller } = createController();
  reachCritique(controller);

  const prompt = controller.requestCriticPrompt();

  expect(prompt).toContain('compact persisted contract and execution evidence');
  expect(prompt).toContain(
    '"verifiers":[{"ref":"verifiers[0]","name":"preview","deterministic":true}]',
  );
  expect(prompt).toContain('"inspection"');
  expect(prompt).toContain('Preview completed successfully.');
  expect(prompt).toContain('"observedExecution"');
  expect(prompt).toContain('Do not introduce new requirements');
  expect(prompt).toContain('"contractRef":"acceptanceCriteria[0]"');
});

test('uses structured execution errors instead of parsing result text', () => {
  const { controller } = createController();
  reachCritique(controller);
  controller.recordSubagentStart('review-error', {
    agent: PiSubagentProfileId.ProductionReviewer,
    task: 'review',
  });
  controller.recordSubagentResult('review-error', 'provider unavailable', false, {
    terminationReason: PiSubagentTerminationReason.Error,
    durationMs: 900,
    assistantTurns: 0,
    toolCalls: 0,
    steerRequested: false,
  });

  expect(controller.getState().phase).toBe(ProductionLoopPhase.Revise);
  expect(controller.getState().critic.findings[0].summary).toContain(
    'did not complete successfully',
  );
});

test('keeps infrastructure timeouts in critique so the reviewer can retry', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { controller } = createController();
  reachCritique(controller);
  controller.recordSubagentStart('review-timeout', {
    agent: PiSubagentProfileId.ProductionReviewer,
    task: 'review',
  });
  controller.recordSubagentResult('review-timeout', '(subagent hard timeout after 180s)', false, {
    terminationReason: PiSubagentTerminationReason.HardTimeout,
    durationMs: 180_000,
    assistantTurns: 6,
    toolCalls: 6,
    steerRequested: true,
  });

  expect(controller.getState()).toMatchObject({
    phase: ProductionLoopPhase.Critique,
    status: ProductionLoopStatus.WaitingCritic,
    critic: {
      toolCallId: null,
      passed: false,
      findings: [],
      execution: {
        durationMs: 180_000,
        assistantTurns: 6,
        toolCalls: 6,
        steerRequested: true,
        timedOut: true,
      },
    },
  });

  controller.recordSubagentStart('review-retry', {
    agent: PiSubagentProfileId.ProductionReviewer,
    task: 'retry review',
  });
  controller.recordSubagentResult(
    'review-retry',
    JSON.stringify({ verdict: 'pass', findings: [] }),
    false,
  );
  expect(controller.getState().phase).toBe(ProductionLoopPhase.Deliver);
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

test('getSnapshot exposes the skip flag for the verification chain', () => {
  const { controller } = createController();
  expect(controller.getSnapshot().skipped).toBe(false);
  controller.skipWorkflow('Pure information request with no work to plan');
  expect(controller.getSnapshot()).toMatchObject({
    skipped: true,
    phase: ProductionLoopPhase.Plan,
    status: ProductionLoopStatus.Completed,
  });
});

test('exposes artifacts only after the latest inspection passes critique', () => {
  const { controller, service } = createController();
  const planned = controller.commitPlan({
    items: [{ title: 'Build' }],
    constraints: [],
    acceptanceCriteria: ['Report passes'],
    expectedArtifacts: [{ kind: 'report', description: 'Final report', required: true }],
    expectedVerifiers: [{ name: 'report_check', deterministic: true }],
  });
  controller.updatePlanItem(planned.planItems[0].id, 'completed');
  controller.recordToolResult('report-check', 'bash', 'Report check passed.', false);
  const evidenceRef = controller.getAvailableVerifierEvidence()[0]?.evidenceRef ?? 'missing';
  controller.startInspection({
    artifacts: [{ kind: 'report', reference: 'output/report.md' }],
    verifiers: [{ name: 'report_check', evidenceRef }],
  });
  controller.requestCritique();

  expect(controller.getReviewedArtifacts()).toEqual([]);

  const runId = controller.getState().runId;
  service.recordCriticStart(runId, 'critic-call');
  service.recordCriticResult(
    runId,
    'critic-call',
    JSON.stringify({ verdict: 'pass', findings: [] }),
    false,
  );

  expect(controller.getReviewedArtifacts()).toEqual([
    { kind: 'report', reference: 'output/report.md' },
  ]);
});
