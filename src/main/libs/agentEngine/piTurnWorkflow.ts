/** Persisted skill availability does not select a new turn's controlled workflow. */
export function resolvePiTurnWorkflowSkills(options: {
  attachedSkillIds?: string[];
  availableSkillIds?: string[];
  previousWorkflowSkillIds?: string[];
}): string[] | undefined {
  return (
    options.attachedSkillIds ??
    options.previousWorkflowSkillIds ??
    options.availableSkillIds
  )?.slice();
}
