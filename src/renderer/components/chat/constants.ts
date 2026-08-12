import { FileText, Globe, GraduationCap, Presentation, Table, Telescope } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AcademicResearchSkillIds, CoreSkillId } from '@shared/skills/constants';

/**
 * Chat quick-skill shortcut entries.
 *
 * Shared by the sidebar shortcut list and the active-skill badge so the
 * semantic label and icon stay in sync for core skills.
 */
export interface ChatSkillShortcut {
  id: string;
  skillId: string;
  /** Additional capabilities selected with the primary shortcut skill. */
  skillIds?: readonly string[];
  icon: LucideIcon;
  labelKey: string;
  /** Placeholder shown in the chat input while this skill is active. */
  placeholderKey: string;
}

export const CHAT_SKILL_SHORTCUTS: readonly ChatSkillShortcut[] = [
  {
    id: 'ppt',
    skillId: CoreSkillId.PresentationStudio,
    icon: Presentation,
    labelKey: 'chatSkillPpt',
    placeholderKey: 'chatSkillPlaceholderPpt',
  },
  {
    id: 'deep-research',
    skillId: 'deep-research',
    // Deep research is a retrieval workflow. Selecting only its protocol
    // leaves researchers without the bundled search capability.
    skillIds: [CoreSkillId.DeepResearch, CoreSkillId.WebSearch],
    icon: Telescope,
    labelKey: 'chatSkillDeepResearch',
    placeholderKey: 'chatSkillPlaceholderDeepResearch',
  },
  {
    id: 'academic-research',
    skillId: 'deli-autoresearch',
    skillIds: AcademicResearchSkillIds,
    icon: GraduationCap,
    labelKey: 'chatSkillAcademicResearch',
    placeholderKey: 'chatSkillPlaceholderAcademicResearch',
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

export const getChatSkillShortcutIds = (entry: ChatSkillShortcut): readonly string[] =>
  entry.skillIds ?? [entry.skillId];

export const isChatSkillShortcutActive = (
  entry: ChatSkillShortcut,
  activeSkillIds: readonly string[],
): boolean => {
  const shortcutSkillIds = getChatSkillShortcutIds(entry);
  return (
    shortcutSkillIds.length === activeSkillIds.length &&
    shortcutSkillIds.every(skillId => activeSkillIds.includes(skillId))
  );
};

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
