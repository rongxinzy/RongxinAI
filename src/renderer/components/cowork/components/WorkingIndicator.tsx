import React, { useEffect, useRef, useState } from 'react';

import { Shimmer } from '@shared/components/ai-elements/shimmer';
import { Spinner } from '@shared/components/ui/spinner';

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

export interface WorkingIndicatorProps {
  /** Override status label for tool preparation / execution / post-tool wait states. */
  statusLabel?: string;
  /** Optional target summary or generated char count shown alongside statusLabel. */
  detailLabel?: string;
  /** When true, show the spinner and elapsed seconds right away instead of after 8s. */
  showElapsedImmediately?: boolean;
  /** Resets the elapsed timer when the underlying active phase or tool call changes. */
  resetKey?: string;
}

/**
 * Live "still working" indicator shown at the bottom of an active streaming
 * turn while waiting for the first token, streaming tool inputs, running tools,
 * or awaiting the model's follow-up response.
 */
export const WorkingIndicator: React.FC<WorkingIndicatorProps> = ({
  statusLabel,
  detailLabel,
  showElapsedImmediately = false,
  resetKey = '',
}) => {
  const startedAtRef = useRef(Date.now());
  const prevResetKeyRef = useRef(resetKey);
  if (prevResetKeyRef.current !== resetKey) {
    prevResetKeyRef.current = resetKey;
    startedAtRef.current = Date.now();
  }
  const [now, setNow] = useState(startedAtRef.current);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resetKey]);

  const elapsedMs = Math.max(0, now - startedAtRef.current);
  const phase = getWorkingIndicatorPhase(elapsedMs);
  const resolvedStatus =
    statusLabel ??
    i18nService.t(
      phase === WorkingIndicatorPhase.Escalated
        ? 'coworkWorkingLongSilence'
        : 'coworkWorkingThinking',
    );
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const showElapsed = showElapsedImmediately
    ? elapsedSeconds > 0
    : phase !== WorkingIndicatorPhase.Initial;

  return (
    <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
      {showElapsedImmediately ? (
        <Spinner aria-hidden="true" role="presentation" className="size-3.5 shrink-0" />
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Shimmer duration={1.5} className="text-sm">
          {resolvedStatus}
        </Shimmer>
        {detailLabel ? (
          <span className="max-w-xs truncate text-xs text-muted-foreground">{detailLabel}</span>
        ) : null}
        {showElapsed ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {i18nService.t('coworkWorkingElapsed').replace('{seconds}', String(elapsedSeconds))}
          </span>
        ) : null}
      </div>
    </div>
  );
};
