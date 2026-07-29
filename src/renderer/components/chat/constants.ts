import { FileText, Globe, Presentation, Table, Telescope } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Chat quick-skill shortcut entries.
 *
 * Shared by the sidebar shortcut list and the active-skill badge so the
 * semantic label and icon stay in sync for core skills.
 */
export interface ChatSkillShortcut {
  id: string;
  skillId: string;
  icon: LucideIcon;
  labelKey: string;
  /** Placeholder shown in the chat input while this skill is active. */
  placeholderKey: string;
}

export const CHAT_SKILL_SHORTCUTS: readonly ChatSkillShortcut[] = [
  {
    id: 'ppt',
    skillId: 'pptx',
    icon: Presentation,
    labelKey: 'chatSkillPpt',
    placeholderKey: 'chatSkillPlaceholderPpt',
  },
  {
    id: 'deep-research',
    skillId: 'deep-research',
    icon: Telescope,
    labelKey: 'chatSkillDeepResearch',
    placeholderKey: 'chatSkillPlaceholderDeepResearch',
  },
  {
    id: 'docs',
    skillId: 'docx',
    icon: FileText,
    labelKey: 'chatSkillDocs',
    placeholderKey: 'chatSkillPlaceholderDocs',
  },
  {
    id: 'website',
    skillId: 'frontend-design',
    icon: Globe,
    labelKey: 'chatSkillWebsite',
    placeholderKey: 'chatSkillPlaceholderWebsite',
  },
  {
    id: 'sheets',
    skillId: 'xlsx',
    icon: Table,
    labelKey: 'chatSkillSheets',
    placeholderKey: 'chatSkillPlaceholderSheets',
  },
] as const;

export const findChatSkillShortcut = (skillId: string): ChatSkillShortcut | undefined =>
  CHAT_SKILL_SHORTCUTS.find(entry => entry.skillId === skillId);

/**
 * Returns the placeholder i18n key of the first active shortcut skill, so
 * the chat input can hint at the task the attached skill performs.
 */
export const resolveSkillPlaceholderKey = (activeSkillIds: string[]): string | undefined => {
  for (const skillId of activeSkillIds) {
    const shortcut = findChatSkillShortcut(skillId);
    if (shortcut) return shortcut.placeholderKey;
  }
  return undefined;
};
