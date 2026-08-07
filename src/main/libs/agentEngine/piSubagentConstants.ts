export const PiSubagentProfileId = {
  Researcher: 'researcher',
  Scout: 'scout',
  Planner: 'planner',
  Reviewer: 'reviewer',
  ProductionReviewer: 'production-reviewer',
} as const;

export type PiSubagentProfileId =
  (typeof PiSubagentProfileId)[keyof typeof PiSubagentProfileId];

export const PiSubagentToolName = 'subagent';

export const PiSubagentTerminationReason = {
  Settled: 'settled',
  Error: 'error',
  HardTimeout: 'hard_timeout',
} as const;
export type PiSubagentTerminationReason =
  (typeof PiSubagentTerminationReason)[keyof typeof PiSubagentTerminationReason];
