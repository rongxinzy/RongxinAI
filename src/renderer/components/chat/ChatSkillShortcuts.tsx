import { cn } from '@shared/lib/utils';
import { FileText, Globe, Presentation, Table, Telescope } from 'lucide-react';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { selectIsStreaming } from '../../store/selectors/coworkSelectors';
import { clearCurrentSession } from '../../store/slices/coworkSlice';
import { setActiveSkillIds } from '../../store/slices/skillSlice';

// Quick-skill shortcut entries shown above the chat session list.
const CHAT_SKILL_SHORTCUTS = [
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

type ChatSkillShortcut = (typeof CHAT_SKILL_SHORTCUTS)[number];

const ChatSkillShortcuts: React.FC = () => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const isStreaming = useSelector(selectIsStreaming);

  const handleSelect = (entry: ChatSkillShortcut) => {
    if (isStreaming) return;
    // Require the skill to be enabled — disabled skills must not be
    // re-activated through the shortcut (matches SkillsPopover filtering).
    const skill = skills.find(s => s.id === entry.skillId && s.enabled);
    if (!skill) {
      window.dispatchEvent(
        new CustomEvent('app:showToast', { detail: i18nService.t('chatSkillUnavailable') }),
      );
      return;
    }
    dispatch(setActiveSkillIds([skill.id]));
    dispatch(clearCurrentSession());
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', { detail: { clear: false } }));
    }, 0);
  };

  return (
    <div className="mb-1">
      <div className="flex h-10 items-center px-1.5">
        <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
          {i18nService.t('chatQuickSkillsTitle')}
        </h2>
      </div>
      <div className="space-y-0.5">
        {CHAT_SKILL_SHORTCUTS.map(entry => {
          const Icon = entry.icon;
          const isActive = activeSkillIds.includes(entry.skillId);
          return (
            <button
              key={entry.id}
              type="button"
              disabled={isStreaming}
              onClick={() => handleSelect(entry)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[14px] transition-colors',
                isActive
                  ? 'bg-black/3 font-medium text-foreground dark:bg-white/4'
                  : 'text-muted-foreground hover:bg-black/3 hover:text-foreground dark:hover:bg-white/4',
                isStreaming && 'pointer-events-none opacity-50',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{i18nService.t(entry.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ChatSkillShortcuts;
