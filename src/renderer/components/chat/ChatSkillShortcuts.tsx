import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { MotionConfig, useReducedMotion } from 'motion/react';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { selectIsStreaming } from '../../store/selectors/coworkSelectors';
import { clearCurrentSession } from '../../store/slices/coworkSlice';
import { selectAction } from '../../store/slices/quickActionSlice';
import { setActiveSkillIds } from '../../store/slices/skillSlice';
import {
  AnimatedFileTextIcon,
  type AnimatedFileTextIconHandle,
} from '../icons/AnimatedFileTextIcon';
import { AnimatedBlocksIcon, type AnimatedBlocksIconHandle } from '../icons/AnimatedBlocksIcon';
import {
  AnimatedLaptopMinimalCheckIcon,
  type AnimatedLaptopMinimalCheckIconHandle,
} from '../icons/AnimatedLaptopMinimalCheckIcon';
import {
  AnimatedGraduationCapIcon,
  type AnimatedGraduationCapIconHandle,
} from '../icons/AnimatedGraduationCapIcon';
import {
  AnimatedMonitorCheckIcon,
  type AnimatedMonitorCheckIconHandle,
} from '../icons/AnimatedMonitorCheckIcon';
import {
  AnimatedTelescopeIcon,
  type AnimatedTelescopeIconHandle,
} from '../icons/AnimatedTelescopeIcon';
import {
  CHAT_SKILL_SHORTCUTS,
  ChatSkillShortcut,
  getChatSkillShortcutIds,
  isChatSkillShortcutActive,
} from './constants';

type AnimatedIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

const ChatSkillShortcuts: React.FC = () => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const quickActions = useSelector((state: RootState) => state.quickAction.actions);
  const isStreaming = useSelector(selectIsStreaming);
  const documentIconRef = React.useRef<AnimatedFileTextIconHandle>(null);
  const academicIconRef = React.useRef<AnimatedGraduationCapIconHandle>(null);
  const pptIconRef = React.useRef<AnimatedMonitorCheckIconHandle>(null);
  const telescopeIconRef = React.useRef<AnimatedTelescopeIconHandle>(null);
  const blocksIconRef = React.useRef<AnimatedBlocksIconHandle>(null);
  const laptopIconRef = React.useRef<AnimatedLaptopMinimalCheckIconHandle>(null);
  const prefersReducedMotion = useReducedMotion();
  const animatedShortcutIcons: Partial<
    Record<
      ChatSkillShortcut['id'],
      { icon: React.ReactNode; ref: React.RefObject<AnimatedIconHandle | null> }
    >
  > = {
    docs: { icon: <AnimatedFileTextIcon ref={documentIconRef} />, ref: documentIconRef },
    'academic-research': {
      icon: <AnimatedGraduationCapIcon ref={academicIconRef} />,
      ref: academicIconRef,
    },
    ppt: { icon: <AnimatedMonitorCheckIcon ref={pptIconRef} />, ref: pptIconRef },
    'deep-research': {
      icon: <AnimatedTelescopeIcon ref={telescopeIconRef} />,
      ref: telescopeIconRef,
    },
    sheets: { icon: <AnimatedBlocksIcon ref={blocksIconRef} />, ref: blocksIconRef },
    website: { icon: <AnimatedLaptopMinimalCheckIcon ref={laptopIconRef} />, ref: laptopIconRef },
  };

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
      // Switching shortcut skills starts a new prompt context. Clear the
      // previous case text while preserving the conversation transcript.
      window.dispatchEvent(new CustomEvent('cowork:focus-input', { detail: { clear: true } }));
    }, 0);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mb-2">
        <div className="flex h-9 items-center px-1.5">
          <h2 className="min-w-0 truncate text-sm font-normal text-muted-foreground">
            {i18nService.t('chatQuickSkillsTitle')}
          </h2>
        </div>
        <div className="space-y-0.5">
          {CHAT_SKILL_SHORTCUTS.map(entry => {
            const Icon = entry.icon;
            const animatedIcon = animatedShortcutIcons[entry.id];
            const isActive = isChatSkillShortcutActive(entry, activeSkillIds);
            return (
              <Button
                key={entry.id}
                type="button"
                variant="ghost"
                data-chat-skill-shortcut={entry.id}
                disabled={isStreaming}
                onMouseEnter={() => {
                  if (!prefersReducedMotion) animatedIcon?.ref.current?.startAnimation();
                }}
                onMouseLeave={() => {
                  animatedIcon?.ref.current?.stopAnimation();
                }}
                onClick={() => handleSelect(entry)}
                className={cn(
                  'theme-page-chat-skill-shortcuts-button-variant-1 chat-skill-shortcut w-full justify-start text-left',
                  isActive
                    ? 'theme-page-chat-skill-shortcuts-button-variant-2'
                    : 'theme-page-chat-skill-shortcuts-button-variant-3',
                )}
              >
                {animatedIcon?.icon ?? (
                  <Icon aria-hidden="true" className="chat-skill-shortcut-icon size-4 shrink-0" />
                )}
                <span className="min-w-0 truncate">{i18nService.t(entry.labelKey)}</span>
              </Button>
            );
          })}
        </div>
      </div>
    </MotionConfig>
  );
};

export default ChatSkillShortcuts;
