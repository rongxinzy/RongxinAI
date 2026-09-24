import React, { useEffect, useRef, useState } from 'react';

import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { cn } from '@shared/lib/utils';

import { i18nService } from '../../../services/i18n';
import { AgentCompanion } from '../../agentCompanion/AgentCompanion';
import { AgentCompanionState } from '../../agentCompanion/constants';

export const WORKING_INDICATOR_ELAPSED_THRESHOLD_MS = 8_000;
export const WORKING_INDICATOR_ESCALATION_THRESHOLD_MS = 30_000;

export const WorkingIndicatorPhase = {
  Initial: 'initial',
  Elapsed: 'elapsed',
  Escalated: 'escalated',
} as const;

export type WorkingIndicatorPhase =
  (typeof WorkingIndicatorPhase)[keyof typeof WorkingIndicatorPhase];

export const getWorkingIndicatorPhase = (elapsedMs: number): WorkingIndicatorPhase => {
  if (elapsedMs >= WORKING_INDICATOR_ESCALATION_THRESHOLD_MS) {
    return WorkingIndicatorPhase.Escalated;
  }
  if (elapsedMs >= WORKING_INDICATOR_ELAPSED_THRESHOLD_MS) {
    return WorkingIndicatorPhase.Elapsed;
  }
  return WorkingIndicatorPhase.Initial;
};

/**
 * Live "still working" indicator shown while a session has started streaming
 * but no assistant content has arrived yet. It only renders during that
 * initial wait window, so mount time is a faithful stand-in for the last
 * activity timestamp. The companion is the single animated state indicator;
 * the elapsed ticker remains informational text under reduced motion.
 */
export const WorkingIndicator: React.FC<{ showCompanion?: boolean }> = ({
  showCompanion = true,
}) => {
  const startedAtRef = useRef(Date.now());
  const [now, setNow] = useState(startedAtRef.current);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedMs = now - startedAtRef.current;
  const phase = getWorkingIndicatorPhase(elapsedMs);
  const statusText = i18nService.t(
    phase === WorkingIndicatorPhase.Escalated
      ? 'coworkWorkingLongSilence'
      : 'coworkWorkingThinking',
  );

  return (
    <div
      className={cn(
        'flex animate-fade-in items-center gap-2',
        showCompanion ? 'min-h-9' : 'min-h-6',
      )}
      role="status"
      aria-live="polite"
    >
      {showCompanion && <AgentCompanion state={AgentCompanionState.Thinking} />}
      <div className="flex min-w-0 items-center gap-2">
        {showCompanion ? (
          <span className="text-sm text-muted-foreground">{statusText}</span>
        ) : (
          <Shimmer duration={1.5} className="text-sm">
            {statusText}
          </Shimmer>
        )}
        {phase !== WorkingIndicatorPhase.Initial && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {i18nService
              .t('coworkWorkingElapsed')
              .replace('{seconds}', String(Math.floor(elapsedMs / 1000)))}
          </span>
        )}
      </div>
    </div>
  );
};
