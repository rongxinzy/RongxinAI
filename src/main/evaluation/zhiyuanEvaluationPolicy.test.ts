import { describe, expect, test } from 'vitest';

import {
  ZhiyuanEvaluationActivation,
  ZhiyuanEvaluationPolicyProtocolVersion,
  ZhiyuanEvaluationToolMode,
} from './constants';
import type { ZhiyuanEvaluationPolicyContext } from './types';
import { createZhiyuanEvaluationPolicy } from './zhiyuanEvaluationPolicy';

const context = (toolMode: ZhiyuanEvaluationPolicyContext['toolMode']) => {
  const activations: string[] = [];
  const value: ZhiyuanEvaluationPolicyContext = {
    protocolVersion: ZhiyuanEvaluationPolicyProtocolVersion,
    candidateId: 'candidate-sha',
    runId: 'run-1',
    sampleId: 'sample-1',
    modelProfile: 'gemma-local',
    prompt: 'Complete the task.',
    toolMode,
    tools: [{ name: 'bash' }, { name: 'python' }],
    metadata: {},
    candidateRoot: process.cwd(),
    workspace: process.cwd(),
    agentDir: process.cwd(),
    emitActivation: name => activations.push(name),
  };
  return { activations, value };
};

describe('createZhiyuanEvaluationPolicy', () => {
  test('loads production resources and orchestration for execute tracks', () => {
    const testContext = context(ZhiyuanEvaluationToolMode.Execute);

    const policy = createZhiyuanEvaluationPolicy(testContext.value);

    expect(policy.systemPrompt).toContain('ZhiYuan Agent');
    expect(policy.skillPaths).toEqual(['SKILLs']);
    expect(policy.customTools?.map(tool => tool.name)).toEqual(['agent_loop']);
    expect(testContext.activations).toContain(ZhiyuanEvaluationActivation.PolicyLoaded);
  });

  test('rejects capture tracks as non-agent capability runs', () => {
    const testContext = context(ZhiyuanEvaluationToolMode.Capture);

    const policy = createZhiyuanEvaluationPolicy(testContext.value);

    expect(policy.customTools).toBeUndefined();
    expect(testContext.activations).toEqual([ZhiyuanEvaluationActivation.PolicyBypassed]);
  });
});
