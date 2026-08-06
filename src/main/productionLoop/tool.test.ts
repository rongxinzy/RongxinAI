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
  planItems: [{ id: 'item-1', title: 'Build', status: ProductionPlanItemStatus.Pending }],
  critic: { requested: false },
  deliveryReason: null,
};

const createTool = () => {
  const controller = {
    getState: vi.fn(() => state),
    commitPlan: vi.fn(),
    updatePlanItem: vi.fn(),
    skipWorkflow: vi.fn(),
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

test('returns model-visible state with generated plan item IDs', async () => {
  const { tool } = createTool();

  const output = await tool.execute('call', { action: ProductionLoopAction.GetState });

  expect(JSON.parse(output.content[0].text)).toEqual(state);
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
  expect(output.details).toEqual(state);
});

test('does not dispatch unknown actions', async () => {
  const { controller, tool } = createTool();

  const output = await tool.execute('call', { action: 'delete_everything' });

  expect(output.content[0].text).toBe('Unknown production_loop action: delete_everything');
  expect(controller.commitPlan).not.toHaveBeenCalled();
  expect(controller.updatePlanItem).not.toHaveBeenCalled();
});

test('skip_workflow forwards the reason to the controller', async () => {
  const { controller, tool } = createTool();

  const output = await tool.execute('call', {
    action: ProductionLoopAction.SkipWorkflow,
    reason: 'Pure information request',
  });

  expect(controller.skipWorkflow).toHaveBeenCalledWith('Pure information request');
  expect(output.content[0].text).toContain('skipped');
});
