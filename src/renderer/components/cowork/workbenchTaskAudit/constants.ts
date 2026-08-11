export const WorkbenchTaskAuditTab = {
  Runs: 'runs',
  Events: 'events',
  Artifacts: 'artifacts',
  Approvals: 'approvals',
} as const;

export type WorkbenchTaskAuditTab =
  (typeof WorkbenchTaskAuditTab)[keyof typeof WorkbenchTaskAuditTab];
