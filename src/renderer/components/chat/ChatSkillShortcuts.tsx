import { cn } from '@shared/lib/utils';
import { MotionConfig, useReducedMotion } from 'motion/react';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import { selectIsStreaming } from '../../store/selectors/coworkSelectors';
import { clearCurrentSession } from '../../store/slices/coworkSlice';
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
import { CHAT_SKILL_SHORTCUTS, ChatSkillShortcut } from './constants';

type AnimatedIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

const ChatSkillShortcuts: React.FC = () => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);
  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
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
            const selectedSkillIds = entry.skillIds || [entry.skillId];
            const isActive = selectedSkillIds.every(skillId => activeSkillIds.includes(skillId));
            return (
              <button
                key={entry.id}
                type="button"
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
                  'chat-skill-shortcut flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors',
                  isActive
                    ? 'bg-surface-raised font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground',
                  isStreaming && 'pointer-events-none opacity-50',
                )}
              >
                {animatedIcon?.icon ?? (
                  <Icon aria-hidden="true" className="chat-skill-shortcut-icon size-4 shrink-0" />
                )}
                <span className="min-w-0 truncate">{i18nService.t(entry.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </MotionConfig>
  );
};

export default ChatSkillShortcuts;
