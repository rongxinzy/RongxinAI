import { motion, useReducedMotion } from 'motion/react';

import { cn } from '@shared/lib/utils';

import completedImage from '../../assets/agent-companion/zhiyuan-scholar-completed.png';
import thinkingImage from '../../assets/agent-companion/zhiyuan-scholar-thinking.png';
import { i18nService } from '../../services/i18n';
import { AgentCompanionState, type AgentCompanionState as CompanionState } from './constants';

interface AgentCompanionProps {
  state: CompanionState;
  className?: string;
}

const transitionTimingFunction = [0.16, 1, 0.3, 1] as const;
// The source poses have different silhouettes. These scales equalize their
// visible alpha area without enlarging the shared 36px layout slot.
const thinkingVisualScale = 0.95;
const completedVisualScale = 1.05;

export const AgentCompanion = ({ state, className }: AgentCompanionProps) => {
  const reduceMotion = useReducedMotion();
  const isThinking = state === AgentCompanionState.Thinking;
  const isCompleted = state === AgentCompanionState.Completed;
  const label = i18nService.t(
    isThinking
      ? 'agentCompanionThinkingLabel'
      : isCompleted
        ? 'agentCompanionCompletedLabel'
        : 'agentCompanionIdleLabel',
  );

  return (
    <span
      className={cn('relative block size-9 shrink-0', className)}
      role="img"
      aria-label={label}
    >
      <motion.img
        src={thinkingImage}
        alt=""
        className="absolute inset-0 size-full object-contain"
        initial={false}
        animate={
          reduceMotion || !isThinking
            ? {
                opacity: isCompleted ? 0 : 1,
                rotate: 0,
                scale: thinkingVisualScale,
                scaleX: 1,
                scaleY: 1,
                y: 0,
              }
            : {
                opacity: 1,
                rotate: [-3, 2, -3],
                scale: thinkingVisualScale,
                scaleX: [1, 0.96, 1],
                scaleY: [1, 1.06, 1],
                y: [1, -4, 1],
              }
        }
        transition={
          reduceMotion || !isThinking
            ? { duration: 0.2, ease: transitionTimingFunction }
            : {
                duration: 1.2,
                ease: transitionTimingFunction,
                repeat: Number.POSITIVE_INFINITY,
              }
        }
      />
      <motion.img
        src={completedImage}
        alt=""
        className="absolute inset-0 size-full object-contain"
        initial={false}
        animate={{
          opacity: isCompleted ? 1 : 0,
          scale: isCompleted ? completedVisualScale : 0.98,
          y: 0,
        }}
        transition={{
          duration: reduceMotion ? 0 : 0.45,
          ease: transitionTimingFunction,
        }}
      />
    </span>
  );
};
