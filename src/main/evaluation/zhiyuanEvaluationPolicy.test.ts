import { describe, expect, test, vi } from 'vitest';

import { HarnessActivationType, type HarnessActivationEvent } from '../../shared/harness';
import { ProductionLoopAction, ProductionPlanItemStatus } from '../../shared/productionLoop';
import { PiAgentLoopAction } from '../libs/agentEngine/piAgentLoop';
import {
  ZhiyuanEvaluationActivation,
  ZhiyuanEvaluationPolicyId,
  ZhiyuanEvaluationPolicyProtocolVersion,
  ZhiyuanEvaluationPolicyVersion,
  ZhiyuanEvaluationToolMode,
} from './constants';
import type { ZhiyuanEvaluationPolicyContext, ZhiyuanEvaluationTool } from './types';
import { createZhiyuanEvaluationPolicy } from './zhiyuanEvaluationPolicy';

const context = (
  toolMode: ZhiyuanEvaluationPolicyContext['toolMode'],
): { value: ZhiyuanEvaluationPolicyContext; activations: HarnessActivationEvent[] } => {
  const activations: HarnessActivationEvent[] = [];
  return {
    activations,
    value: {
      protocolVersion: ZhiyuanEvaluationPolicyProtocolVersion,
      candidateId: 'candidate-sha',
      runId: 'run-1',
      sampleId: 'sample-1',
      modelProfile: 'gemma-local',
      prompt: 'Inspect the workspace and solve the operating-system task.',
      toolMode,
      tools: [{ name: 'bash' }, { name: 'python' }],
      metadata: {},
      candidateRoot: process.cwd(),
      workspace: process.cwd(),
      agentDir: process.cwd(),
      emitActivation: (activation, evidence) => {
        activations.push({
          activation: activation as HarnessActivationEvent['activation'],
          evidence,
        });
      },
    },
  };
};

const tool = (tools: ZhiyuanEvaluationTool[] | undefined, name: string): ZhiyuanEvaluationTool => {
  const found = tools?.find(candidate => candidate.name === name);
  if (!found) throw new Error(`Tool not found: ${name}`);
  return found;
};

describe('createZhiyuanEvaluationPolicy', () => {
  test('bypasses capture-only model controls', () => {
    const testContext = context(ZhiyuanEvaluationToolMode.Capture);

    const policy = createZhiyuanEvaluationPolicy(testContext.value);

    expect(policy).toEqual({
      protocolVersion: ZhiyuanEvaluationPolicyProtocolVersion,
      id: ZhiyuanEvaluationPolicyId,
      version: ZhiyuanEvaluationPolicyVersion,
    });
    expect(testContext.activations).toEqual([
      expect.objectContaining({ activation: ZhiyuanEvaluationActivation.PolicyBypassed }),
    ]);
  });

  test('loads production resources and drives production gates', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const testContext = context(ZhiyuanEvaluationToolMode.Execute);
    const policy = createZhiyuanEvaluationPolicy(testContext.value);
    const productionTool = tool(policy.customTools, 'production_loop');
    const loopTool = tool(policy.customTools, 'agent_loop');

    expect(policy.systemPrompt).toContain('ZhiYuan Agent');
    expect(policy.skillPaths).toEqual(['SKILLs']);
    expect(policy.customTools?.map(candidate => candidate.name)).toEqual([
      'production_loop',
      'agent_loop',
    ]);

    const plan = (await productionTool.execute('plan', {
      action: ProductionLoopAction.CommitPlan,
      items: [{ title: 'Inspect and solve the task' }],
      acceptanceCriteria: ['The requested state is observable.'],
      expectedVerifiers: [{ name: 'official benchmark scorer', deterministic: true }],
    })) as { details: { planItems: Array<{ id: string }> } };
    await productionTool.execute('item', {
      action: ProductionLoopAction.UpdatePlanItem,
      itemId: plan.details.planItems[0].id,
      status: ProductionPlanItemStatus.Completed,
    });
    await productionTool.execute('inspect', { action: ProductionLoopAction.StartInspection });
    await productionTool.execute('critic', { action: ProductionLoopAction.RequestCritique });
    policy.onEvent?.({
      type: 'tool_execution_end',
      toolName: 'bash',
      result: { content: [{ type: 'text', text: 'checks passed' }] },
      isError: false,
    });

    const criticTurn = await policy.onAgentEnd?.({ iteration: 1, messages: [], usage: {} });
    expect(criticTurn?.nextPrompt).toContain('read-only');
    const deliveryTurn = await policy.onAgentEnd?.({
      iteration: 2,
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '{"verdict":"pass","findings":[]}' }],
        },
      ],
      usage: {},
    });
    expect(deliveryTurn?.nextPrompt).toContain('agent_loop done');
    await loopTool.execute('done', {
      action: PiAgentLoopAction.Done,
      reason: 'The task and production gates are complete.',
    });
    expect(await policy.onAgentEnd?.({ iteration: 3, messages: [], usage: {} })).toEqual({
      shouldContinue: false,
    });

    expect(testContext.activations.map(event => event.activation)).toEqual(
      expect.arrayContaining([
        ZhiyuanEvaluationActivation.PolicyLoaded,
        ZhiyuanEvaluationActivation.CriticDegraded,
        ZhiyuanEvaluationActivation.ProductionToolStarted,
        ZhiyuanEvaluationActivation.ProductionToolCompleted,
        HarnessActivationType.PlanCommitted,
        HarnessActivationType.CriticRequested,
      ]),
    );
  });

  test('rejects an incompatible bridge contract', () => {
    const testContext = context(ZhiyuanEvaluationToolMode.Execute);
    testContext.value.protocolVersion = '999';

    expect(() => createZhiyuanEvaluationPolicy(testContext.value)).toThrow(
      'Unsupported evaluation policy protocol',
    );
  });
});
