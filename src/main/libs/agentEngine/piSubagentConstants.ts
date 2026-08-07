export const PiSubagentProfileId = {
  Researcher: 'researcher',
  Scout: 'scout',
  Planner: 'planner',
  Reviewer: 'reviewer',
  ProductionReviewer: 'production-reviewer',
} as const;

export type PiSubagentProfileId =
  (typeof PiSubagentProfileId)[keyof typeof PiSubagentProfileId];
