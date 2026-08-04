import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { HarnessActivationEvent } from '../../shared/harness';
import { createPiWorkLoop } from '../libs/agentEngine/piWorkLoop';
import {
  ZhiyuanEvaluationActivation,
  ZhiyuanEvaluationPolicyId,
  ZhiyuanEvaluationPolicyProtocolVersion,
  ZhiyuanEvaluationPolicyVersion,
  ZhiyuanEvaluationToolMode,
} from './constants';
import type { ZhiyuanEvaluationPolicy, ZhiyuanEvaluationPolicyContext } from './types';

const identity = (): Pick<ZhiyuanEvaluationPolicy, 'protocolVersion' | 'id' | 'version'> => ({
  protocolVersion: ZhiyuanEvaluationPolicyProtocolVersion,
  id: ZhiyuanEvaluationPolicyId,
  version: ZhiyuanEvaluationPolicyVersion,
});

const activationEvidence = (event: HarnessActivationEvent): Record<string, unknown> => ({
  ...(event.iteration === undefined ? {} : { iteration: event.iteration }),
  ...(event.mechanism === undefined ? {} : { mechanism: event.mechanism }),
  ...(event.evidence === undefined ? {} : { evidence: event.evidence }),
});

export function createZhiyuanEvaluationPolicy(
  context: ZhiyuanEvaluationPolicyContext,
): ZhiyuanEvaluationPolicy {
  if (context.protocolVersion !== ZhiyuanEvaluationPolicyProtocolVersion) {
    throw new Error(`Unsupported evaluation policy protocol: ${context.protocolVersion}`);
  }
  if (context.toolMode !== ZhiyuanEvaluationToolMode.Execute) {
    context.emitActivation(ZhiyuanEvaluationActivation.PolicyBypassed, {
      toolMode: context.toolMode,
      reason: 'Production runtime requires sandbox-backed execute mode.',
    });
    return identity();
  }

  const systemPrompt = readFileSync(
    path.join(context.candidateRoot, 'resources', 'SYSTEM_PROMPT.md'),
    'utf8',
  );
  const workLoop = createPiWorkLoop({
    goal: context.prompt,
    onActivation: event => context.emitActivation(event.activation, activationEvidence(event)),
    start: true,
  });
  context.emitActivation(ZhiyuanEvaluationActivation.PolicyLoaded, {
    policyVersion: ZhiyuanEvaluationPolicyVersion,
    modelProfile: context.modelProfile,
    toolNames: context.tools.map(tool => tool.name),
    resources: ['resources/SYSTEM_PROMPT.md', 'SKILLs'],
    orchestration: ['agent_loop'],
    disabledInteractiveFeatures: ['approval_ui', 'ask_user', 'mcp', 'subagent'],
  });

  return {
    ...identity(),
    systemPrompt,
    promptPrefix: workLoop.initialPrompt,
    skillPaths: ['SKILLs'],
    customTools: [workLoop.tool as ZhiyuanEvaluationPolicy['customTools'][number]],
    onAgentEnd: () => workLoop.controller.handleAgentEnd(),
  };
}
