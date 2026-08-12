export const HarnessFailureWhere = {
  Prompt: 'prompt',
  KnowledgeOrSkill: 'knowledge_or_skill',
  Runtime: 'runtime',
  Config: 'config',
} as const;
export type HarnessFailureWhere = (typeof HarnessFailureWhere)[keyof typeof HarnessFailureWhere];

export const HarnessFailureWhy = {
  PrematureFinalize: 'premature_finalize',
  UnverifiedDelivery: 'unverified_delivery',
  MissingOrInvalidArtifact: 'missing_or_invalid_artifact',
  RepeatedToolCall: 'repeated_tool_call',
  StaleNoProgress: 'stale_no_progress',
  ThinkingRunawayOrEmptyTurn: 'thinking_runaway_or_empty_turn',
  WrongToolOrSkillRoute: 'wrong_tool_or_skill_route',
  ReviewerDisagreement: 'reviewer_disagreement',
  InfraFailure: 'infra_failure',
  ModelCapabilityLimit: 'model_capability_limit',
} as const;
export type HarnessFailureWhy = (typeof HarnessFailureWhy)[keyof typeof HarnessFailureWhy];

export const HarnessInfraStatus = {
  NotApplicable: 'not_applicable',
  Retryable: 'retryable',
  Terminal: 'terminal',
} as const;
export type HarnessInfraStatus = (typeof HarnessInfraStatus)[keyof typeof HarnessInfraStatus];

export const HarnessActivationType = {
  PrototypeGenerated: 'prototype_generated',
  PlanCommitted: 'plan_committed',
  PrematureFinalizeBlocked: 'premature_finalize_blocked',
  RepeatToolBreakerFired: 'repeat_tool_breaker_fired',
  StaleIterationPivoted: 'stale_iteration_pivoted',
  PreviewRendered: 'preview_rendered',
  CriticRequested: 'critic_requested',
  CriticRejected: 'critic_rejected',
  RevisionApplied: 'revision_applied',
  WorkflowSkipped: 'workflow_skipped',
  RecoveryTriggered: 'recovery_triggered',
} as const;
export type HarnessActivationType =
  (typeof HarnessActivationType)[keyof typeof HarnessActivationType];

export const HarnessFeatureFlag = {
  ConditionalPrototype: 'conditional_prototype',
  IndependentCritic: 'independent_critic',
  RepeatToolBreaker: 'repeat_tool_breaker',
  StaleIterationRecovery: 'stale_iteration_recovery',
} as const;
export type HarnessFeatureFlag = (typeof HarnessFeatureFlag)[keyof typeof HarnessFeatureFlag];

export const HarnessFeatureFlagDefaults: Readonly<Record<HarnessFeatureFlag, boolean>> = {
  [HarnessFeatureFlag.ConditionalPrototype]: false,
  [HarnessFeatureFlag.IndependentCritic]: false,
  [HarnessFeatureFlag.RepeatToolBreaker]: false,
  [HarnessFeatureFlag.StaleIterationRecovery]: false,
};

export const HarnessPatchStatus = {
  Proposed: 'proposed',
  Rejected: 'rejected',
  Promoted: 'promoted',
  RolledBack: 'rolled_back',
} as const;
export type HarnessPatchStatus = (typeof HarnessPatchStatus)[keyof typeof HarnessPatchStatus];

export const HarnessPathClass = {
  Surface: 'surface',
  Kernel: 'kernel',
  OutsideBoundary: 'outside_boundary',
} as const;
export type HarnessPathClass = (typeof HarnessPathClass)[keyof typeof HarnessPathClass];

export const HarnessVersion = '237-p0-v1';
