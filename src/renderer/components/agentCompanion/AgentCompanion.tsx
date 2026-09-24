import { motion, useReducedMotion, type TargetAndTransition, type Transition } from 'motion/react';
import { memo, useSyncExternalStore } from 'react';

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

const thinkingAnimation: TargetAndTransition = {
  opacity: 1,
  rotate: [-3, 2, -3],
  scale: thinkingVisualScale,
  scaleX: [1, 0.96, 1],
  scaleY: [1, 1.06, 1],
  y: [1, -4, 1],
};
const restingAnimation: TargetAndTransition = {
  opacity: 1,
  rotate: 0,
  scale: thinkingVisualScale,
  scaleX: 1,
  scaleY: 1,
  y: 0,
};
const hiddenThinkingAnimation: TargetAndTransition = { ...restingAnimation, opacity: 0 };
const completedAnimation: TargetAndTransition = { opacity: 1, scale: completedVisualScale, y: 0 };
const hiddenCompletedAnimation: TargetAndTransition = { opacity: 0, scale: 0.98, y: 0 };
// A slow loop communicates an ongoing task without competing with streamed text.
const thinkingTransition: Transition = {
  duration: 1.2,
  ease: transitionTimingFunction,
  repeat: Number.POSITIVE_INFINITY,
};
const restingTransition: Transition = { duration: 0.2, ease: transitionTimingFunction };
const completedTransition: Transition = { duration: 0.45, ease: transitionTimingFunction };
const reducedTransition: Transition = { duration: 0 };
const subscribeLanguage = (listener: () => void) => i18nService.subscribe(listener);
const getLanguage = () => i18nService.getLanguage();

export const AgentCompanion = memo(function AgentCompanion({
  state,
  className,
}: AgentCompanionProps) {
  // Memoization must not freeze the accessible label when the language changes.
  useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
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
    <span className={cn('relative block size-9 shrink-0', className)} role="img" aria-label={label}>
      <motion.img
        src={thinkingImage}
        alt=""
        className="absolute inset-0 size-full object-contain"
        initial={isThinking && !reduceMotion ? restingAnimation : false}
        animate={
          isCompleted
            ? hiddenThinkingAnimation
            : reduceMotion || !isThinking
              ? restingAnimation
              : thinkingAnimation
        }
        transition={
          reduceMotion ? reducedTransition : isThinking ? thinkingTransition : restingTransition
        }
      />
      <motion.img
        src={completedImage}
        alt=""
        className="absolute inset-0 size-full object-contain"
        initial={false}
        animate={isCompleted ? completedAnimation : hiddenCompletedAnimation}
        transition={reduceMotion ? reducedTransition : completedTransition}
      />
    </span>
  );
});
