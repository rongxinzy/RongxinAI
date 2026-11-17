import { cn } from '@shared/lib/utils';
import { memo, useSyncExternalStore } from 'react';
import { ThinkingOrb } from 'thinking-orbs';

import { i18nService } from '../../services/i18n';
import { AgentCompanionState, type AgentCompanionState as CompanionState } from './constants';

interface AgentCompanionProps {
  state: CompanionState;
  className?: string;
}

const subscribeLanguage = (listener: () => void) => i18nService.subscribe(listener);
const getLanguage = () => i18nService.getLanguage();

export const AgentCompanion = memo(function AgentCompanion({
  state,
  className,
}: AgentCompanionProps) {
  useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
  const isThinking = state === AgentCompanionState.Thinking;
  const label = i18nService.t(
    isThinking
      ? 'agentCompanionThinkingLabel'
      : state === AgentCompanionState.Completed
        ? 'agentCompanionCompletedLabel'
        : 'agentCompanionIdleLabel',
  );

  return (
    <span
      className={cn('flex size-9 shrink-0 items-center justify-center', className)}
      role="img"
      aria-label={label}
    >
      <ThinkingOrb state="working" size={32} paused={!isThinking} aria-hidden="true" />
    </span>
  );
});
