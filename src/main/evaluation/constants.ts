export const ZhiyuanEvaluationPolicyProtocolVersion = '1';
export const ZhiyuanEvaluationPolicyId = 'rongxinai-production-runtime';
export const ZhiyuanEvaluationPolicyVersion = '237-foundation-v1';

export const ZhiyuanEvaluationToolMode = {
  None: 'none',
  Capture: 'capture',
  Execute: 'execute',
} as const;
export type ZhiyuanEvaluationToolMode =
  (typeof ZhiyuanEvaluationToolMode)[keyof typeof ZhiyuanEvaluationToolMode];

export const ZhiyuanEvaluationActivation = {
  PolicyLoaded: 'evaluation_policy_loaded',
  PolicyBypassed: 'evaluation_policy_bypassed',
} as const;
