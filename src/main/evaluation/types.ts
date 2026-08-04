import type { ZhiyuanEvaluationToolMode } from './constants';

export interface ZhiyuanEvaluationTool {
  name: string;
  execute(toolCallId: string, params: Record<string, unknown>): Promise<unknown>;
  [key: string]: unknown;
}

export interface ZhiyuanEvaluationPolicyContext {
  protocolVersion: string;
  candidateId: string;
  runId: string;
  sampleId: string;
  modelProfile: string;
  prompt: string;
  systemPrompt?: string;
  toolMode: ZhiyuanEvaluationToolMode;
  tools: ReadonlyArray<{ name: string; [key: string]: unknown }>;
  metadata: Readonly<Record<string, unknown>>;
  candidateRoot: string;
  workspace: string;
  agentDir: string;
  emitActivation(name: string, evidence?: Record<string, unknown>): void;
}

export interface ZhiyuanEvaluationAgentEndInput {
  iteration: number;
  messages: unknown[];
  usage: Record<string, unknown>;
}

export interface ZhiyuanEvaluationContinueDecision {
  shouldContinue: boolean;
  nextPrompt?: string;
}

export interface ZhiyuanEvaluationPolicy {
  protocolVersion: string;
  id: string;
  version: string;
  systemPrompt?: string;
  promptPrefix?: string;
  skillPaths?: string[];
  customTools?: ZhiyuanEvaluationTool[];
  onEvent?(event: Record<string, unknown>): void;
  onAgentEnd?(
    input: ZhiyuanEvaluationAgentEndInput,
  ): ZhiyuanEvaluationContinueDecision | Promise<ZhiyuanEvaluationContinueDecision>;
  dispose?(): void | Promise<void>;
}
