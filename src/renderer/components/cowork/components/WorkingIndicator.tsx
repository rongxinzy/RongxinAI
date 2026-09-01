import React, { useEffect, useRef, useState } from 'react';

import { Shimmer } from '@shared/components/ai-elements/shimmer';

import { i18nService } from '../../../services/i18n';

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
 * activity timestamp. The shimmer loop is the single animated element (per
 * DESIGN.md); the elapsed ticker is informational text, not animation, and
 * stays visible under prefers-reduced-motion.
 */
export const WorkingIndicator: React.FC = () => {
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
    <div className="flex h-6 animate-fade-in items-center gap-2">
      <span className="size-1.5 shrink-0 rounded-full bg-primary" />
      <Shimmer duration={1.5} className="text-sm">
        {statusText}
      </Shimmer>
      {phase !== WorkingIndicatorPhase.Initial && (
        <span className="text-sm text-muted-foreground tabular-nums">
          {i18nService
            .t('coworkWorkingElapsed')
            .replace('{seconds}', String(Math.floor(elapsedMs / 1000)))}
        </span>
      )}
    </div>
  );
};
