export const WorkspaceSkillError = {
  Aborted: 'SKILL_SCRIPT_ABORTED',
  TimedOut: 'SKILL_SCRIPT_TIMEOUT',
  DependenciesUnavailable: 'SKILL_DEPENDENCIES_UNAVAILABLE',
  RuntimeUnavailable: 'SKILL_RUNTIME_UNAVAILABLE',
  Failed: 'SKILL_SCRIPT_FAILED',
} as const;

export const WorkspaceSkillStatus = {
  Completed: 'completed',
  Failed: 'failed',
  TimedOut: 'timed-out',
  Aborted: 'aborted',
  RuntimeUnavailable: 'runtime-unavailable',
} as const;
