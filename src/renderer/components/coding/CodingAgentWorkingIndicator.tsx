import type { ReactNode } from 'react';

import { i18nService } from '../../services/i18n';
import { AgentCompanion } from '../agentCompanion/AgentCompanion';
import { AgentCompanionState } from '../agentCompanion/constants';

/** Shown only while a coding agent has not produced its first turn event. */
export const CodingAgentWorkingIndicator = ({ duration }: { duration?: ReactNode }) => (
  <div className="flex flex-col gap-2 animate-fade-in" role="status" aria-live="polite">
    <div className="flex items-center gap-2">
      <AgentCompanion state={AgentCompanionState.Thinking} />
      <span className="text-sm text-muted-foreground">
        {i18nService.t('codingAgentWaiting')}
      </span>
      {duration}
    </div>
  </div>
);
