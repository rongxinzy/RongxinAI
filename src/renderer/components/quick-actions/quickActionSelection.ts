import type { LocalizedQuickAction } from '../../types/quickAction';
import type { Skill } from '../../types/skill';

export const quickActionSkillIds = (action: LocalizedQuickAction): string[] =>
  action.skillIds?.length ? action.skillIds : [action.skillMapping];

export function shouldClearQuickActionSelection(
  action: LocalizedQuickAction,
  skills: Skill[],
  activeSkillIds: string[],
): boolean {
  const skillIds = quickActionSkillIds(action);
  const allMappedSkillsExist = skillIds.every(skillId =>
    skills.some(skill => skill.id === skillId),
  );

  // Keep prompt-only quick actions available when the mapped skill is not
  // loaded in the current mode.
  return allMappedSkillsExist && !skillIds.every(skillId => activeSkillIds.includes(skillId));
}
