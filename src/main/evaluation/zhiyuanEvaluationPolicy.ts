import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { HarnessActivationEvent } from '../../shared/harness';
import { ProductionLoopAction, ProductionLoopPhase } from '../../shared/productionLoop';
import { WorkbenchContractKind, type WorkbenchJsonObject } from '../../shared/workbenchTask';
import { createPiWorkLoop } from '../libs/agentEngine/piWorkLoop';
import { ProductionLoopController } from '../productionLoop/controller';
import type { ProductionLoopMeasurement } from '../productionLoop/ports';
import { ProductionLoopService } from '../productionLoop/service';
import { buildProductionLoopTool } from '../productionLoop/tool';
import {
  ZhiyuanEvaluationActivation,
  ZhiyuanEvaluationCriticToolCallPrefix,
  ZhiyuanEvaluationCriticToolName,
  ZhiyuanEvaluationEventType,
  ZhiyuanEvaluationPolicyId,
  ZhiyuanEvaluationPolicyProtocolVersion,
  ZhiyuanEvaluationPolicyVersion,
  ZhiyuanEvaluationToolMode,
} from './constants';
import { InMemoryProductionLoopStore } from './inMemoryProductionLoopStore';
import type {
  ZhiyuanEvaluationAgentEndInput,
  ZhiyuanEvaluationPolicy,
  ZhiyuanEvaluationPolicyContext,
  ZhiyuanEvaluationTool,
} from './types';

const definedEvidence = (event: HarnessActivationEvent): WorkbenchJsonObject => {
  const evidence: WorkbenchJsonObject = {};
  if (event.iteration !== undefined) evidence.iteration = event.iteration;
  if (event.mechanism !== undefined) evidence.mechanism = event.mechanism;
  if (event.evidence !== undefined) evidence.evidence = event.evidence;
  return evidence;
};

const assistantText = (messages: unknown[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== 'object') continue;
    const raw = message as Record<string, unknown>;
    if (raw.role !== 'assistant') continue;
    if (typeof raw.content === 'string') return raw.content;
    if (!Array.isArray(raw.content)) continue;
    return raw.content
      .flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const content = item as Record<string, unknown>;
        return content.type === 'text' && typeof content.text === 'string' ? [content.text] : [];
      })
      .join('\n');
  }
  return '';
};

const toolResultText = (result: unknown): string => {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const content = (result as Record<string, unknown>).content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const raw = item as Record<string, unknown>;
      return raw.type === 'text' && typeof raw.text === 'string' ? [raw.text] : [];
    })
    .join('\n');
};

const boundedSummary = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, 240);

interface EvaluationToolEvidence {
  toolName: string;
  outcome: 'succeeded' | 'failed';
  resultSummary: string;
}

const policyIdentity = (): Pick<ZhiyuanEvaluationPolicy, 'protocolVersion' | 'id' | 'version'> => ({
  protocolVersion: ZhiyuanEvaluationPolicyProtocolVersion,
  id: ZhiyuanEvaluationPolicyId,
  version: ZhiyuanEvaluationPolicyVersion,
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
    return policyIdentity();
  }

  const systemPrompt = readFileSync(
    path.join(context.candidateRoot, 'resources', 'SYSTEM_PROMPT.md'),
    'utf8',
  );
  const measurement: ProductionLoopMeasurement = {
    recordActivation(_runId: string, event: HarnessActivationEvent): void {
      context.emitActivation(event.activation, definedEvidence(event));
    },
  };
  const service = new ProductionLoopService(new InMemoryProductionLoopStore(), measurement);
  const controller = new ProductionLoopController(service, {
    taskId: `evaluation-task:${context.sampleId}`,
    runId: context.runId,
    workflowKind: WorkbenchContractKind.GenericWork,
    goal: context.prompt,
    prototypeRequired: false,
  });
  const productionTool = buildProductionLoopTool(controller) as ZhiyuanEvaluationTool;
  const executeProductionTool = productionTool.execute.bind(productionTool);
  const inspectToolNames = new Set(context.tools.map(tool => tool.name));
  const toolEvidence: EvaluationToolEvidence[] = [];
  productionTool.execute = async (toolCallId, params) => {
    const before = controller.getState();
    const action = typeof params.action === 'string' ? params.action : 'missing';
    context.emitActivation(ZhiyuanEvaluationActivation.ProductionToolStarted, {
      action,
      phase: before.phase,
      status: before.status,
    });
    const output = await executeProductionTool(toolCallId, params);
    const after = controller.getState();
    const progressed = after.progressVersion > before.progressVersion;
    context.emitActivation(ZhiyuanEvaluationActivation.ProductionToolCompleted, {
      action,
      phaseBefore: before.phase,
      phaseAfter: after.phase,
      statusAfter: after.status,
      progressed,
      resultSummary:
        action === ProductionLoopAction.GetState
          ? 'state_observed'
          : progressed
            ? 'state_advanced'
            : boundedSummary(toolResultText(output)),
    });
    return output;
  };
  const workLoop = createPiWorkLoop({
    goal: context.prompt,
    completionWorkflow: controller,
    onActivation: event => context.emitActivation(event.activation, definedEvidence(event)),
    start: true,
  });
  const agentLoop = workLoop.controller;
  let criticFallbackPending = false;
  let criticAttempt = 0;

  context.emitActivation(ZhiyuanEvaluationActivation.PolicyLoaded, {
    policyVersion: ZhiyuanEvaluationPolicyVersion,
    modelProfile: context.modelProfile,
    toolNames: context.tools.map(tool => tool.name),
    resources: ['resources/SYSTEM_PROMPT.md', 'SKILLs'],
    orchestration: ['production_loop', 'agent_loop'],
    disabledInteractiveFeatures: ['approval_ui', 'ask_user', 'mcp', 'subagent'],
  });
  context.emitActivation(ZhiyuanEvaluationActivation.CriticDegraded, {
    reason: 'No independent reviewer model is configured for this evaluation.',
    mode: 'same_model_transcript_only',
    readOnly: true,
  });

  const onEvent = (event: Record<string, unknown>): void => {
    const toolName = typeof event.toolName === 'string' ? event.toolName : '';
    if (
      event.type === ZhiyuanEvaluationEventType.ToolExecutionEnd &&
      inspectToolNames.has(toolName)
    ) {
      toolEvidence.push({
        toolName,
        outcome: event.isError === true ? 'failed' : 'succeeded',
        resultSummary: boundedSummary(toolResultText(event.result)),
      });
      if (toolEvidence.length > 20) toolEvidence.shift();
    }
    if (toolName !== ZhiyuanEvaluationCriticToolName) return;
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
    if (!toolCallId) return;
    if (event.type === ZhiyuanEvaluationEventType.ToolExecutionStart) {
      controller.recordSubagentStart(toolCallId, event.args);
    } else if (event.type === ZhiyuanEvaluationEventType.ToolExecutionEnd) {
      controller.recordSubagentResult(
        toolCallId,
        toolResultText(event.result),
        event.isError === true,
      );
    }
  };

  const onAgentEnd = (input: ZhiyuanEvaluationAgentEndInput) => {
    if (criticFallbackPending) {
      criticFallbackPending = false;
      criticAttempt += 1;
      const toolCallId = `${ZhiyuanEvaluationCriticToolCallPrefix}-${criticAttempt}`;
      controller.recordSubagentStart(toolCallId, { agent: 'reviewer' });
      const output = assistantText(input.messages);
      controller.recordSubagentResult(toolCallId, output, !output.trim());
      const critic = controller.getState().critic;
      context.emitActivation(ZhiyuanEvaluationActivation.CriticCompleted, {
        attempt: criticAttempt,
        mode: 'same_model_transcript_only',
        outputPresent: Boolean(output.trim()),
        passed: critic.passed,
        findingSeverities: critic.findings.map(finding => finding.severity),
      });
    }

    const state = controller.getState();
    if (
      state.phase === ProductionLoopPhase.Critique &&
      state.critic.requested &&
      !state.critic.toolCallId
    ) {
      criticFallbackPending = true;
      return {
        shouldContinue: true,
        nextPrompt: [
          controller.requestCriticPrompt(),
          'Evaluation constraint: act as a read-only critic in this turn.',
          `Observed Inspect sandbox tool outcomes: ${JSON.stringify(toolEvidence)}`,
          'Treat successful required tool outcomes as execution evidence.',
          'The official benchmark scorer remains the final deterministic gate after delivery.',
          'Do not call tools or modify files. Return exactly the requested JSON object.',
        ].join('\n'),
      };
    }
    return agentLoop.handleAgentEnd();
  };

  return {
    ...policyIdentity(),
    systemPrompt,
    promptPrefix: [
      'All file and command effects must use the benchmark tools provided by Inspect.',
      controller.buildInitialPrompt(),
      workLoop.initialPrompt,
    ].join('\n\n'),
    skillPaths: ['SKILLs'],
    customTools: [productionTool, workLoop.tool as ZhiyuanEvaluationTool],
    onEvent,
    onAgentEnd,
  };
}
