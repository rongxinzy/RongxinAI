import { Button } from '@shared/components/ui/button';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { selectIsStreaming } from '../../store/selectors/coworkSelectors';
import { clearCurrentSession } from '../../store/slices/coworkSlice';
import { selectAction } from '../../store/slices/quickActionSlice';
import { setActiveSkillIds } from '../../store/slices/skillSlice';
import {
  CHAT_SKILL_SHORTCUTS,
  ChatSkillShortcut,
  getChatSkillShortcutIds,
  isChatSkillShortcutActive,
} from './constants';

const ChatSkillShortcuts: React.FC = () => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const quickActions = useSelector((state: RootState) => state.quickAction.actions);
  const isStreaming = useSelector(selectIsStreaming);

  const handleSelect = (entry: ChatSkillShortcut) => {
    if (isStreaming) return;
    const selectedSkillIds = getChatSkillShortcutIds(entry);
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
    const quickActionIdByShortcut: Record<string, string> = {
      ppt: 'pptx',
      sheets: 'data-analysis',
      website: 'website',
      docs: 'docs',
      'deep-research': 'deep-research',
      'academic-research': 'academic-research',
    };
    const quickActionId = quickActionIdByShortcut[entry.id];
    dispatch(
      selectAction(quickActions.some(action => action.id === quickActionId) ? quickActionId : null),
    );
    dispatch(clearCurrentSession());
    window.setTimeout(() => {
      // 2026/09/16 lixiang  切换快捷 skill 只聚焦输入框，保留已输入的 prompt，不清空
      window.dispatchEvent(new CustomEvent('cowork:focus-input', { detail: { clear: false } }));
    }, 0);
  };

  return (
    <div className="mb-2">
      <div className="theme-sidebar-section flex items-center min-w-0">
        <h2 className="min-w-0 truncate">{i18nService.t('chatQuickSkillsTitle')}</h2>
      </div>
      <div className="space-y-0.5">
        {CHAT_SKILL_SHORTCUTS.map(entry => {
          const Icon = entry.icon;
          const isActive = isChatSkillShortcutActive(entry, activeSkillIds);
          return (
            <Button
              key={entry.id}
              type="button"
              variant="navigation"
              size="navigation"
              data-chat-skill-shortcut={entry.id}
              data-active={isActive || undefined}
              disabled={isStreaming}
              onClick={() => handleSelect(entry)}
              className="chat-skill-shortcut w-full justify-start"
            >
              <Icon
                aria-hidden="true"
                className="chat-skill-shortcut-icon size-4 shrink-0"
                strokeWidth={1.75}
              />
              <span className="min-w-0 truncate">{i18nService.t(entry.labelKey)}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
};

export default ChatSkillShortcuts;
