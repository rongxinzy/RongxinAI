import type { LocalizedQuickAction } from '../../types/quickAction';
import type { Skill } from '../../types/skill';

export function shouldClearQuickActionSelection(
  action: LocalizedQuickAction,
  skills: Skill[],
  activeSkillIds: string[],
): boolean {
  const mappedSkillExists = skills.some(skill => skill.id === action.skillMapping);

  // Keep prompt-only quick actions available when the mapped skill is not
  // loaded in the current mode.
  return mappedSkillExists && !activeSkillIds.includes(action.skillMapping);
}
