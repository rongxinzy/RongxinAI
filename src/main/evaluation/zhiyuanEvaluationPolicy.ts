import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { HarnessActivationEvent } from '../../shared/harness';
import { ProductionLoopAction, ProductionLoopPhase } from '../../shared/productionLoop';
import { WorkbenchContractKind, type WorkbenchJsonObject } from '../../shared/workbenchTask';
import { createPiWorkLoop } from '../libs/agentEngine/piWorkLoop';
import { ProductionLoopController } from '../productionLoop/controller';
import { extractPiSubagentExecutionMetadata } from '../libs/agentEngine/piSubagentExecution';
import type { ProductionLoopMeasurement } from '../productionLoop/ports';
import { ProductionLoopService } from '../productionLoop/service';
import { buildProductionLoopTool } from '../productionLoop/tool';
import {
  ZhiyuanEvaluationActivation,
  ZhiyuanEvaluationCriticToolName,
  ZhiyuanEvaluationEventType,
  ZhiyuanEvaluationPolicyId,
  ZhiyuanEvaluationPolicyProtocolVersion,
  ZhiyuanEvaluationPolicyVersion,
  ZhiyuanEvaluationToolMode,
} from './constants';
import { InMemoryProductionLoopStore } from './inMemoryProductionLoopStore';
import type {
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
    // Evaluation measures the full harness gate, including the independent
    // reviewer; never run evaluation runs in lightweight mode.
    forceStandardReview: true,
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
  const reviewerCapability = context.runtimeCapabilities?.reviewerSubagent;
  const isolatedReviewerAvailable = Boolean(
    reviewerCapability &&
      reviewerCapability.isolated &&
      reviewerCapability.readOnly &&
      Array.isArray(reviewerCapability.tools) &&
      reviewerCapability.tools.length === 0,
  );
  let criticAttempt = 0;

  context.emitActivation(ZhiyuanEvaluationActivation.PolicyLoaded, {
    policyVersion: ZhiyuanEvaluationPolicyVersion,
    modelProfile: context.modelProfile,
    toolNames: context.tools.map(tool => tool.name),
    resources: ['resources/SYSTEM_PROMPT.md', 'SKILLs'],
    orchestration: [
      'production_loop',
      'agent_loop',
      ...(isolatedReviewerAvailable ? ['reviewer_subagent'] : []),
    ],
    disabledInteractiveFeatures: [
      'approval_ui',
      'ask_user',
      'mcp',
      ...(!isolatedReviewerAvailable ? ['subagent'] : []),
    ],
  });
  if (!isolatedReviewerAvailable) {
    context.emitActivation(ZhiyuanEvaluationActivation.CriticDegraded, {
      reason: 'No isolated reviewer subagent is configured for this evaluation.',
      mode: 'unavailable_fail_closed',
      readOnly: true,
    });
  }

  const onEvent = (event: Record<string, unknown>): void => {
    const toolName = typeof event.toolName === 'string' ? event.toolName : '';
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
    if (
      event.type === ZhiyuanEvaluationEventType.ToolExecutionEnd &&
      toolName &&
      toolCallId
    ) {
      controller.recordToolResult(
        toolCallId,
        toolName,
        toolResultText(event.result),
        event.isError === true,
      );
    }
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
    if (!toolCallId) return;
    if (event.type === ZhiyuanEvaluationEventType.ToolExecutionStart) {
      controller.recordSubagentStart(toolCallId, event.args);
    } else if (event.type === ZhiyuanEvaluationEventType.ToolExecutionEnd) {
      const execution = extractPiSubagentExecutionMetadata(event.result);
      controller.recordSubagentResult(
        toolCallId,
        toolResultText(event.result),
        event.isError === true,
        execution,
      );
      criticAttempt += 1;
      const critic = controller.getState().critic;
      context.emitActivation(ZhiyuanEvaluationActivation.CriticCompleted, {
        attempt: criticAttempt,
        mode: 'isolated_reviewer_subsession',
        outputPresent: Boolean(toolResultText(event.result).trim()),
        passed: critic.passed,
        findingSeverities: critic.findings.map(finding => finding.severity),
        ...(execution
          ? {
              terminationReason: execution.terminationReason,
              durationMs: execution.durationMs,
              assistantTurns: execution.assistantTurns,
              toolCalls: execution.toolCalls,
              steerRequested: execution.steerRequested,
            }
          : {}),
      });
    }
  };

  const onAgentEnd = () => {
    const state = controller.getState();
    if (
      state.phase === ProductionLoopPhase.Critique &&
      state.critic.requested &&
      !state.critic.toolCallId
    ) {
      if (isolatedReviewerAvailable) {
        return {
          shouldContinue: true,
          nextPrompt: [
            controller.requestCriticPrompt(),
            `Observed Inspect sandbox tool outcomes: ${JSON.stringify(toolEvidence)}`,
            'Include those outcomes in the self-contained reviewer task.',
            'The reviewer has an isolated context and no tools, so do not rely on unstated evidence.',
            'The official benchmark scorer remains the final deterministic gate after delivery.',
          ].join('\n'),
        };
      }
      return { shouldContinue: false };
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
