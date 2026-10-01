import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ZhiyuanEvaluationActivation,
  ZhiyuanEvaluationPolicyId,
  ZhiyuanEvaluationPolicyProtocolVersion,
  ZhiyuanEvaluationPolicyVersion,
  ZhiyuanEvaluationToolMode,
} from './constants';
import type { ZhiyuanEvaluationPolicy, ZhiyuanEvaluationPolicyContext } from './types';

/** Supply product resources while leaving execution and completion to native Pi. */
export async function createZhiyuanEvaluationPolicy(
  context: ZhiyuanEvaluationPolicyContext,
): Promise<ZhiyuanEvaluationPolicy> {
  if (context.protocolVersion !== ZhiyuanEvaluationPolicyProtocolVersion) {
    throw new Error(`Unsupported evaluation policy protocol: ${context.protocolVersion}`);
  }
  const identity = {
    protocolVersion: ZhiyuanEvaluationPolicyProtocolVersion,
    id: ZhiyuanEvaluationPolicyId,
    version: ZhiyuanEvaluationPolicyVersion,
  };
  if (context.toolMode !== ZhiyuanEvaluationToolMode.Execute) {
    context.emitActivation(ZhiyuanEvaluationActivation.PolicyBypassed, {
      toolMode: context.toolMode,
      reason: 'Agent evaluation requires sandbox-backed execute mode.',
    });
    return identity;
  }
  const systemPrompt = await readFile(
    path.join(context.candidateRoot, 'resources', 'SYSTEM_PROMPT.md'),
    'utf8',
  );
  context.emitActivation(ZhiyuanEvaluationActivation.PolicyLoaded, {
    policyVersion: ZhiyuanEvaluationPolicyVersion,
    modelProfile: context.modelProfile,
    toolNames: context.tools.map(tool => tool.name),
    resources: ['resources/SYSTEM_PROMPT.md', 'SKILLs'],
    orchestration: [],
  });
  return {
    ...identity,
    systemPrompt,
    promptPrefix: 'All file and command effects must use the benchmark tools provided by Inspect.',
    skillPaths: ['SKILLs'],
  };
}
