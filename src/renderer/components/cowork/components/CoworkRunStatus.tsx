import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import {
  CoworkRunPhase,
  CoworkRunPolicy,
  type CoworkRunSnapshot,
} from '../../../../shared/cowork/runState';
import { i18nService } from '../../../services/i18n';
import type { RootState } from '../../../store';

const phaseKeys: Record<CoworkRunPhase, string> = {
  [CoworkRunPhase.Waiting]: 'coworkRunWaiting',
  [CoworkRunPhase.Thinking]: 'coworkRunThinking',
  [CoworkRunPhase.Writing]: 'coworkRunWriting',
  [CoworkRunPhase.Tool]: 'coworkRunTool',
  [CoworkRunPhase.Retry]: 'coworkRunRetry',
  [CoworkRunPhase.Compacting]: 'coworkRunCompacting',
  [CoworkRunPhase.Approval]: 'coworkRunApproval',
  [CoworkRunPhase.Finishing]: 'coworkRunFinishing',
  [CoworkRunPhase.Completed]: 'coworkRunCompleted',
  [CoworkRunPhase.Error]: 'coworkRunError',
  [CoworkRunPhase.Stopped]: 'coworkRunStopped',
};

export function getRunStatusText(snapshot: CoworkRunSnapshot | undefined, now: number): string {
  if (!snapshot?.running) return i18nService.t('coworkRunStarting');
  if (now - snapshot.confirmedAt > CoworkRunPolicy.UnconfirmedMs)
    return i18nService.t('coworkRunUnconfirmed');
  let text = i18nService.t(phaseKeys[snapshot.phase]);
  if (snapshot.phase === CoworkRunPhase.Tool && snapshot.toolName)
    text += ` · ${snapshot.toolName}`;
  if (snapshot.phase === CoworkRunPhase.Retry && snapshot.retryAttempt) {
    text += ` · ${i18nService.t('coworkRunAttempt').replace('{attempt}', String(snapshot.retryAttempt))}`;
  }
  return text;
}

/** Owns its ticker so elapsed time never invalidates the transcript or composer. */
export function CoworkRunStatus({
  sessionId,
  isStreaming,
  isDirectChat = false,
}: {
  sessionId: string;
  isStreaming: boolean;
  isDirectChat?: boolean;
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
  const status =
    isDirectChat && !live ? i18nService.t('coworkRunWaiting') : getRunStatusText(live, now);
  const preview = live?.phase === CoworkRunPhase.Tool ? live.preview : undefined;
  const progressSeconds = live ? Math.max(0, Math.floor((now - live.lastProgressAt) / 1_000)) : 0;
  return (
    <Alert role="status" aria-live="off" data-cowork-run-status data-run-phase={live?.phase}>
      <AlertTitle className="flex flex-wrap items-center justify-between gap-x-2">
        <span>{status}</span>
        <span>{i18nService.t('coworkWorkingElapsed').replace('{seconds}', String(elapsed))}</span>
      </AlertTitle>
      <AlertDescription className="min-w-0">
        <div className="flex flex-col gap-1">
          {preview ? (
            <span className="line-clamp-2 break-all" title={preview}>
              {preview}
            </span>
          ) : live?.phase === CoworkRunPhase.Tool ? (
            <span>{i18nService.t('coworkRunNoOutput')}</span>
          ) : null}
          {live && (
            <span>
              {now - live.confirmedAt <= CoworkRunPolicy.UnconfirmedMs &&
                `${i18nService.t('coworkRunAlive')} · `}
              {i18nService.t('coworkRunLastProgress').replace('{seconds}', String(progressSeconds))}
            </span>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
