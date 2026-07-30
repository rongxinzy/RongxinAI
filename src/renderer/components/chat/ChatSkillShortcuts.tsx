import { cn } from '@shared/lib/utils';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { selectIsStreaming } from '../../store/selectors/coworkSelectors';
import { clearCurrentSession } from '../../store/slices/coworkSlice';
import { setActiveSkillIds } from '../../store/slices/skillSlice';
import { CHAT_SKILL_SHORTCUTS, ChatSkillShortcut } from './constants';

const ChatSkillShortcuts: React.FC = () => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const isStreaming = useSelector(selectIsStreaming);

  const handleSelect = (entry: ChatSkillShortcut) => {
    if (isStreaming) return;
    const selectedSkillIds = entry.skillIds || [entry.skillId];
    // Require the skill to be enabled — disabled skills must not be
    // re-activated through the shortcut (matches SkillsPopover filtering).
    const allSkillsAvailable = selectedSkillIds.every(skillId =>
      skills.some(skill => skill.id === skillId && skill.enabled),
    );
    if (!allSkillsAvailable) {
      window.dispatchEvent(
        new CustomEvent('app:showToast', { detail: i18nService.t('chatSkillUnavailable') }),
      );
      return;
    }
    dispatch(setActiveSkillIds([...selectedSkillIds]));
    dispatch(clearCurrentSession());
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', { detail: { clear: false } }));
    }, 0);
  };

  return (
    <div className="mb-2">
      <div className="flex h-9 items-center px-1.5">
        <h2 className="min-w-0 truncate text-[14px] font-normal text-foreground opacity-[0.28]">
          {i18nService.t('chatQuickSkillsTitle')}
        </h2>
      </div>
      <div className="space-y-0.5">
        {CHAT_SKILL_SHORTCUTS.map(entry => {
          const Icon = entry.icon;
          const selectedSkillIds = entry.skillIds || [entry.skillId];
          const isActive = selectedSkillIds.every(skillId => activeSkillIds.includes(skillId));
          return (
            <button
              key={entry.id}
              type="button"
              disabled={isStreaming}
              onClick={() => handleSelect(entry)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[14px] transition-colors',
                isActive
                  ? 'sidebar-interactive-surface-active font-medium text-foreground'
                  : 'sidebar-interactive-surface text-muted-foreground hover:text-foreground',
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
