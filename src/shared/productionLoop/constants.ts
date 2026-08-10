export const ProductionLoopPhase = {
  Explore: 'explore',
  Plan: 'plan',
  Execute: 'execute',
  Inspect: 'inspect',
  Critique: 'critique',
  Revise: 'revise',
  Deliver: 'deliver',
} as const;
export type ProductionLoopPhase = (typeof ProductionLoopPhase)[keyof typeof ProductionLoopPhase];

export const ProductionLoopStatus = {
  Active: 'active',
  WaitingCritic: 'waiting_critic',
  NeedsRevision: 'needs_revision',
  ReadyToDeliver: 'ready_to_deliver',
  Completed: 'completed',
  Failed: 'failed',
} as const;
export type ProductionLoopStatus = (typeof ProductionLoopStatus)[keyof typeof ProductionLoopStatus];

export const ProductionPlanItemStatus = {
  Pending: 'pending',
  InProgress: 'in_progress',
  Completed: 'completed',
  Blocked: 'blocked',
} as const;
export type ProductionPlanItemStatus =
  (typeof ProductionPlanItemStatus)[keyof typeof ProductionPlanItemStatus];

export const ProductionCriticSeverity = {
  Critical: 'critical',
  Major: 'major',
  Minor: 'minor',
} as const;
export type ProductionCriticSeverity =
  (typeof ProductionCriticSeverity)[keyof typeof ProductionCriticSeverity];

export const ProductionCriticVerdict = {
  Pass: 'pass',
  Revise: 'revise',
} as const;
export type ProductionCriticVerdict =
  (typeof ProductionCriticVerdict)[keyof typeof ProductionCriticVerdict];

export const ProductionLoopRecoveryReason = {
  MissingSignal: 'missing_signal',
  PrematureFinalize: 'premature_finalize',
  StaleProgress: 'stale_progress',
  RepeatedToolCall: 'repeated_tool_call',
} as const;
export type ProductionLoopRecoveryReason =
  (typeof ProductionLoopRecoveryReason)[keyof typeof ProductionLoopRecoveryReason];

export const ProductionLoopAction = {
  RecordPrototype: 'record_prototype',
  CommitPlan: 'commit_plan',
  UpdatePlanItem: 'update_plan_item',
  StartInspection: 'start_inspection',
  RequestCritique: 'request_critique',
  RecordRevision: 'record_revision',
  SkipWorkflow: 'skip_workflow',
  GetState: 'get_state',
} as const;
export type ProductionLoopAction = (typeof ProductionLoopAction)[keyof typeof ProductionLoopAction];

export const ProductionLoopToolName = 'production_loop';

/** Stop automatic continuation after repeated turns make no production progress. */
export const MAX_STALE_PRODUCTION_ITERATIONS = 3;
