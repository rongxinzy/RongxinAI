import { expect, test, vi } from 'vitest';

import {
  ProductionLoopAction,
  ProductionLoopPhase,
  ProductionLoopStatus,
  ProductionPlanItemStatus,
} from '../../shared/productionLoop';
import type { ProductionLoopController } from './controller';
import { buildProductionLoopTool } from './tool';

const state = {
  phase: ProductionLoopPhase.Plan,
  status: ProductionLoopStatus.Active,
  acceptanceCriteria: ['Artifact exists'],
  expectedArtifacts: [{ kind: 'file', description: 'report.md', required: true }],
  expectedVerifiers: [{ name: 'artifact_check', deterministic: true }],
  planItems: [{ id: 'item-1', title: 'Build', status: ProductionPlanItemStatus.Pending }],
  critic: { requested: false },
  deliveryReason: null,
};

const availableVerifierEvidence = [
  {
    evidenceRef: 'ev-1234',
    toolName: 'bash',
    outputSummary: 'checks passed',
  },
];

const createTool = () => {
  const controller = {
    getModelState: vi.fn(() => ({ ...state, availableVerifierEvidence })),
    getAvailableVerifierEvidence: vi.fn(() => availableVerifierEvidence),
    commitPlan: vi.fn(() => state),
    startInspection: vi.fn(() => state),
    updatePlanItem: vi.fn(() => state),
    skipWorkflow: vi.fn(() => state),
  } as unknown as ProductionLoopController;
  const tool = buildProductionLoopTool(controller) as {
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
  };
  return { controller, tool };
};

test('publishes concrete nested schemas for model-generated plans', () => {
  const { tool } = createTool();
  const parameters = (
    tool as unknown as {
      parameters: { properties: Record<string, { items?: { required?: string[] } }> };
    }
  ).parameters;

  expect(parameters.properties.items.items?.required).toEqual(['title']);
  expect(parameters.properties.expectedArtifacts.items?.required).toEqual(['kind', 'description']);
  expect(parameters.properties.expectedVerifiers.items?.required).toEqual([
    'name',
    'deterministic',
  ]);
  expect(parameters.properties.verifierEvidence.items?.required).toEqual(['name', 'evidenceRef']);
});

test('normalizes a plan payload before passing it to the controller', async () => {
  const { controller, tool } = createTool();

  const output = await tool.execute('call', {
    action: ProductionLoopAction.CommitPlan,
    items: [{ title: 'Build', detail: 'Create the artifact' }, null, { bad: true }],
    constraints: ['Stay in scope', 42],
    acceptanceCriteria: ['Artifact exists'],
    expectedArtifacts: [
      { kind: 'file', description: 'result.md' },
      { kind: 42, description: 'ignored' },
    ],
    expectedVerifiers: [{ name: 'artifact_check', deterministic: true }, { deterministic: true }],
  });

  expect(controller.commitPlan).toHaveBeenCalledWith({
    items: [{ title: 'Build', detail: 'Create the artifact' }],
    constraints: ['Stay in scope'],
    acceptanceCriteria: ['Artifact exists'],
    expectedArtifacts: [{ kind: 'file', description: 'result.md', required: true }],
    expectedVerifiers: [{ name: 'artifact_check', deterministic: true }],
    selectedDirection: undefined,
  });
  expect(output.content[0].text).toContain('Plan committed');
  expect(output.content[0].text).toContain('item-1');
});

test('returns the slim model view with generated plan item IDs', async () => {
  const { tool } = createTool();

  const output = await tool.execute('call', { action: ProductionLoopAction.GetState });

  expect(JSON.parse(output.content[0].text)).toMatchObject({
    phase: ProductionLoopPhase.Plan,
    status: ProductionLoopStatus.Active,
    planItems: [{ id: 'item-1', title: 'Build', status: ProductionPlanItemStatus.Pending }],
    acceptanceCriteria: ['Artifact exists'],
    availableVerifierEvidence,
  });
});

test('get_state with an unchanged sinceVersion returns a short no-change result', async () => {
  const withVersion = {
    ...state,
    progressVersion: 3,
    skip: null,
  };
  const controller = {
    getModelState: vi.fn(() => ({ ...withVersion, availableVerifierEvidence: [] })),
    getAvailableVerifierEvidence: vi.fn(() => []),
    getState: vi.fn(() => withVersion),
  } as unknown as ProductionLoopController;
  const toolWithVersion = buildProductionLoopTool(controller) as {
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
  };

  const unchanged = await toolWithVersion.execute('call', {
    action: ProductionLoopAction.GetState,
    sinceVersion: 3,
  });
  expect(unchanged.content[0].text).toContain('No state change since version 3');

  const advanced = await toolWithVersion.execute('call', {
    action: ProductionLoopAction.GetState,
    sinceVersion: 2,
  });
  expect(advanced.content[0].text).toContain('"progressVersion":3');
});

test('execution results guide the next step', async () => {
  const { tool } = createTool();

  const updated = await tool.execute('call', {
    action: ProductionLoopAction.UpdatePlanItem,
    itemId: 'item-1',
    status: ProductionPlanItemStatus.Completed,
  });
  expect(updated.content[0].text).toContain('Next:');
});

test('request_critique returns the full reviewer prompt without a generic hint', async () => {
  const critiqueState = {
    ...state,
    phase: ProductionLoopPhase.Critique,
    skip: null,
    critic: { requested: true, passed: false, findings: [] },
  };
  const reviewerPrompt =
    'Call the subagent tool with agent "production-reviewer". The reviewer must remain read-only.';
  const controller = {
    getModelState: vi.fn(() => ({ ...critiqueState, availableVerifierEvidence: [] })),
    getAvailableVerifierEvidence: vi.fn(() => []),
    requestCritique: vi.fn(() => reviewerPrompt),
    getState: vi.fn(() => critiqueState),
  } as unknown as ProductionLoopController;
  const tool = buildProductionLoopTool(controller) as {
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
  };

  const output = await tool.execute('call', { action: ProductionLoopAction.RequestCritique });

  expect(output.content[0].text).toBe(reviewerPrompt);
  expect(output.content[0].text).toContain('production-reviewer');
  // No generic phase hint that would suggest record_revision before the
  // reviewer has even run.
  expect(output.content[0].text).not.toContain('Next:');
  expect(output.content[0].text).not.toContain('record_revision');
});

test('skip_workflow never suggests committing a plan', async () => {
  const skippedState = {
    ...state,
    phase: ProductionLoopPhase.Plan,
    status: ProductionLoopStatus.Completed,
    skip: { reason: 'Direct answer', createdAt: 1 },
    critic: { requested: false, passed: false, findings: [] },
  };
  const controller = {
    getModelState: vi.fn(() => ({ ...skippedState, availableVerifierEvidence: [] })),
    getAvailableVerifierEvidence: vi.fn(() => []),
    skipWorkflow: vi.fn(() => skippedState),
  } as unknown as ProductionLoopController;
  const tool = buildProductionLoopTool(controller) as {
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
  };

  const output = await tool.execute('call', {
    action: ProductionLoopAction.SkipWorkflow,
    reason: 'Direct answer',
  });

  expect(controller.skipWorkflow).toHaveBeenCalledWith('Direct answer');
  expect(output.content[0].text).toContain('skipped');
  expect(output.content[0].text).toContain('Answer directly');
  expect(output.content[0].text).not.toContain('commit_plan');
});

test('passes model-visible evidence references into inspection', async () => {
  const { controller, tool } = createTool();

  await tool.execute('call', {
    action: ProductionLoopAction.StartInspection,
    artifactEvidence: [{ kind: 'file', reference: 'report.md' }],
    verifierEvidence: [{ name: 'artifact_check', evidenceRef: 'ev-1234' }],
  });

  expect(controller.startInspection).toHaveBeenCalledWith({
    artifacts: [{ kind: 'file', reference: 'report.md' }],
    verifiers: [{ name: 'artifact_check', evidenceRef: 'ev-1234' }],
  });
});

test('returns available evidence when inspection validation fails', async () => {
  const { controller, tool } = createTool();
  vi.mocked(controller.startInspection).mockImplementation(() => {
    throw new Error('Passing deterministic verifier evidence is missing for: artifact_check');
  });

  const output = await tool.execute('call', {
    action: ProductionLoopAction.StartInspection,
    verifierEvidence: [{ name: 'artifact_check', evidenceRef: 'ev-invalid' }],
  });

  expect(output.content[0].text).toContain('ev-1234');
  expect(output.content[0].text).toContain('checks passed');
});

test('returns controller validation errors without advancing the tool state', async () => {
  const { controller, tool } = createTool();
  vi.mocked(controller.commitPlan).mockImplementation(() => {
    throw new Error('At least one plan item is required.');
  });

  const output = await tool.execute('call', {
    action: ProductionLoopAction.CommitPlan,
    items: 'malformed',
  });

  expect(output.content[0].text).toBe('At least one plan item is required.');
  expect(output.details).toMatchObject(state);
});

test('does not dispatch unknown actions', async () => {
  const { controller, tool } = createTool();

  const output = await tool.execute('call', { action: 'delete_everything' });

  expect(output.content[0].text).toBe('Unknown production_loop action: delete_everything');
  expect(controller.commitPlan).not.toHaveBeenCalled();
  expect(controller.updatePlanItem).not.toHaveBeenCalled();
});
