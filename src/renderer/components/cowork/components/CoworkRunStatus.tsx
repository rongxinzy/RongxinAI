import { Spinner } from '@shared/components/ui/spinner';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  CoworkRunPhase,
  CoworkRunPolicy,
  type CoworkRunSnapshot,
} from '../../../../shared/cowork/runState';
import { i18nService } from '../../../services/i18n';
import type { RootState } from '../../../store';

export function getRunStatusText(snapshot: CoworkRunSnapshot | undefined, now: number): string {
  if (!snapshot?.running) return i18nService.t('coworkRunIndicatorStarting');
  if (now - snapshot.confirmedAt > CoworkRunPolicy.UnconfirmedMs)
    return i18nService.t('coworkRunIndicatorReconnecting');
  if (snapshot.phase === CoworkRunPhase.Approval) return i18nService.t('coworkRunApproval');
  return i18nService.t('coworkRunIndicatorRunning');
}

/** Owns its ticker so elapsed time never invalidates the transcript or composer. */
export function CoworkRunStatus({
  sessionId,
  isStreaming,
}: {
  sessionId: string;
  isStreaming: boolean;
}) {
  const snapshot = useSelector((state: RootState) => state.coworkRun.bySession[sessionId]);
  const awaitingSince = useSelector((state: RootState) => state.coworkRun.awaitingSince[sessionId]);
  const [mountedAt, setMountedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const active = isStreaming || snapshot?.running;
  useEffect(() => {
    if (!active) return;
    setMountedAt(Date.now());
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active) return null;
  const live = snapshot?.running && !awaitingSince ? snapshot : undefined;
  const elapsed = Math.max(
    0,
    Math.floor((now - (live?.startedAt ?? awaitingSince ?? mountedAt)) / 1_000),
  );
  const status = getRunStatusText(live, now);
  const clock = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  return (
    <div
      role="status"
      aria-live="off"
      data-cowork-run-status
      data-run-phase={live?.phase}
      className="theme-run-indicator flex shrink-0 items-center justify-center gap-2 overflow-hidden"
    >
      <Spinner aria-hidden="true" role="presentation" className="shrink-0" />
      <span className="truncate">{status}</span>
      <time
        className="theme-run-indicator-elapsed shrink-0"
        dateTime={`PT${elapsed}S`}
        aria-label={i18nService.t('coworkWorkingElapsed').replace('{seconds}', String(elapsed))}
      >
        {clock}
      </time>
    </div>
  );
}
