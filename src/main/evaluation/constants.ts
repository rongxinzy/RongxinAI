export const ZhiyuanEvaluationPolicyProtocolVersion = '1';
export const ZhiyuanEvaluationPolicyId = 'zhiyuan-production-loop';
export const ZhiyuanEvaluationPolicyVersion = '237-p2-v3';

export const ZhiyuanEvaluationToolMode = {
  None: 'none',
  Capture: 'capture',
  Execute: 'execute',
} as const;
export type ZhiyuanEvaluationToolMode =
  (typeof ZhiyuanEvaluationToolMode)[keyof typeof ZhiyuanEvaluationToolMode];

export const ZhiyuanEvaluationEventType = {
  ToolExecutionStart: 'tool_execution_start',
  ToolExecutionEnd: 'tool_execution_end',
} as const;

export const ZhiyuanEvaluationActivation = {
  PolicyLoaded: 'evaluation_policy_loaded',
  PolicyBypassed: 'evaluation_policy_bypassed',
  CriticDegraded: 'evaluation_critic_degraded',
  CriticCompleted: 'evaluation_critic_completed',
  ProductionToolStarted: 'evaluation_production_tool_started',
  ProductionToolCompleted: 'evaluation_production_tool_completed',
} as const;

export const ZhiyuanEvaluationCriticToolName = 'subagent';
export const ZhiyuanEvaluationCriticToolCallPrefix = 'evaluation-critic';
