export const ZhiyuanEvaluationPolicyProtocolVersion = '1';
export const ZhiyuanEvaluationPolicyId = 'zhiyuan-native-pi';
export const ZhiyuanEvaluationPolicyVersion = 'native-pi-v1';

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
} as const;
