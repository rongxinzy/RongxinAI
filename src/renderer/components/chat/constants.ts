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
}

export const CHAT_SKILL_SHORTCUTS: readonly ChatSkillShortcut[] = [
  { id: 'ppt', skillId: 'pptx', icon: Presentation, labelKey: 'chatSkillPpt' },
  {
    id: 'deep-research',
    skillId: 'deep-research',
    icon: Telescope,
    labelKey: 'chatSkillDeepResearch',
  },
  { id: 'docs', skillId: 'docx', icon: FileText, labelKey: 'chatSkillDocs' },
  { id: 'website', skillId: 'frontend-design', icon: Globe, labelKey: 'chatSkillWebsite' },
  { id: 'sheets', skillId: 'xlsx', icon: Table, labelKey: 'chatSkillSheets' },
] as const;

export const findChatSkillShortcut = (skillId: string): ChatSkillShortcut | undefined =>
  CHAT_SKILL_SHORTCUTS.find(entry => entry.skillId === skillId);
