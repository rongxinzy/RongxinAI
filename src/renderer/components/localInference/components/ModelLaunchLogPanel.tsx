import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import type { LlamaCppModelLaunchLogEvent } from '../../../../shared/llamacpp';
import {
  LlamaCppModelLaunchLogLevel,
  LlamaCppModelLaunchLogPhase,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import type { ModelLaunchLogPanelState } from '../hooks/useModelLaunchLogs';
import { ModelLaunchLogPanelStatus } from '../hooks/useModelLaunchLogs';

export function ModelLaunchLogPanel({
  state,
  onCollapsedChange,
  onClose,
}: {
  state: ModelLaunchLogPanelState;
  onCollapsedChange: (collapsed: boolean) => void;
  onClose: () => void;
}) {
  const latestLogAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!state.visible || state.collapsed || state.logs.length === 0) return;

    const frame = window.requestAnimationFrame(() => {
      const viewport = latestLogAnchorRef.current?.closest('[data-slot="scroll-area-viewport"]');
      if (!(viewport instanceof HTMLElement)) return;
      viewport.scrollTop = viewport.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [state.visible, state.collapsed, state.logs.length]);

  if (!state.visible) return null;

  const latestLog = state.logs[state.logs.length - 1];
  const isRunning = state.status === ModelLaunchLogPanelStatus.Starting;

  return (
    <Card className="border-border/80 bg-card/95 shadow-sm">
      <Collapsible
        open={!state.collapsed}
        onOpenChange={open => onCollapsedChange(!open)}
      >
        <CardHeader className="flex flex-row items-center gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-2">
              {isRunning ? <Spinner aria-hidden="true" /> : null}
              <CardTitle className="truncate text-sm font-semibold">
                {i18nService.t('localInferenceModelLaunchLogs')}
              </CardTitle>
              <LaunchStatusBadge status={state.status} />
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {state.modelName
                ? i18nService.t('localInferenceModelLaunchLogsForModel').replace('{name}', state.modelName)
                : i18nService.t('localInferenceModelLaunchLogsWaiting')}
              {state.collapsed && latestLog
                ? ` · ${getPhaseLabel(latestLog.phase)}`
                : ''}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <CollapsibleTrigger render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={i18nService.t(state.collapsed ? 'expand' : 'collapse')}
              >
                {state.collapsed ? <ChevronRight /> : <ChevronDown />}
              </Button>
            } />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={i18nService.t('close')}
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4">
            {state.logs.length > 0 ? (
              <ScrollArea className="h-48 rounded-lg border bg-background/80">
                <div className="flex flex-col gap-2 p-3">
                  {state.logs.map(log => (
                    <LaunchLogRow key={`${log.sessionId}-${log.sequence}`} log={log} />
                  ))}
                  <div ref={latestLogAnchorRef} aria-hidden="true" />
                </div>
              </ScrollArea>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                {i18nService.t('localInferenceModelLaunchLogsWaiting')}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function LaunchStatusBadge({ status }: { status: ModelLaunchLogPanelStatus }) {
  if (status === ModelLaunchLogPanelStatus.Succeeded) {
    return <Badge variant="secondary">{i18nService.t('localInferenceModelLaunchSucceeded')}</Badge>;
  }
  if (status === ModelLaunchLogPanelStatus.Failed) {
    return <Badge variant="destructive">{i18nService.t('localInferenceModelLaunchFailed')}</Badge>;
  }
  return <Badge variant="outline">{i18nService.t('localInferenceModelLaunchStarting')}</Badge>;
}

function LaunchLogRow({ log }: { log: LlamaCppModelLaunchLogEvent }) {
  const detailText = getLogDetailText(log);

  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-xs">
      <div className="font-mono text-muted-foreground">{formatLogTime(log.createdAt)}</div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {log.level !== LlamaCppModelLaunchLogLevel.Info ? (
            <Badge variant={getLevelBadgeVariant(log.level)}>{getLevelLabel(log.level)}</Badge>
          ) : null}
          <span className="font-medium text-foreground">{getPhaseLabel(log.phase)}</span>
        </div>
        {detailText ? (
          <div className={cn(
            'break-all rounded-md bg-muted px-2 py-1 font-mono leading-5 text-muted-foreground',
            log.level === LlamaCppModelLaunchLogLevel.Error && 'text-destructive',
          )}>
            {detailText}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function getLogDetailText(log: LlamaCppModelLaunchLogEvent): string {
  return (log.detail ?? '').trim();
}

function getLevelBadgeVariant(level: LlamaCppModelLaunchLogEvent['level']) {
  if (level === LlamaCppModelLaunchLogLevel.Error) return 'destructive' as const;
  if (level === LlamaCppModelLaunchLogLevel.Warn) return 'secondary' as const;
  return 'outline' as const;
}

function getLevelLabel(level: LlamaCppModelLaunchLogEvent['level']): string {
  switch (level) {
    case LlamaCppModelLaunchLogLevel.Error:
      return i18nService.t('localInferenceModelLaunchLogLevelError');
    case LlamaCppModelLaunchLogLevel.Warn:
      return i18nService.t('localInferenceModelLaunchLogLevelWarn');
    case LlamaCppModelLaunchLogLevel.Debug:
      return i18nService.t('localInferenceModelLaunchLogLevelDebug');
    case LlamaCppModelLaunchLogLevel.Info:
      return i18nService.t('localInferenceModelLaunchLogLevelInfo');
  }
}

function getPhaseLabel(phase: LlamaCppModelLaunchLogEvent['phase']): string {
  switch (phase) {
    case LlamaCppModelLaunchLogPhase.Requested:
      return i18nService.t('localInferenceModelLaunchPhaseRequested');
    case LlamaCppModelLaunchLogPhase.CheckingService:
      return i18nService.t('localInferenceModelLaunchPhaseCheckingService');
    case LlamaCppModelLaunchLogPhase.StartingService:
      return i18nService.t('localInferenceModelLaunchPhaseStartingService');
    case LlamaCppModelLaunchLogPhase.ServiceReady:
      return i18nService.t('localInferenceModelLaunchPhaseServiceReady');
    case LlamaCppModelLaunchLogPhase.PreparingModel:
      return i18nService.t('localInferenceModelLaunchPhasePreparingModel');
    case LlamaCppModelLaunchLogPhase.CheckingRuntime:
      return i18nService.t('localInferenceModelLaunchPhaseCheckingRuntime');
    case LlamaCppModelLaunchLogPhase.LoadingModel:
      return i18nService.t('localInferenceModelLaunchPhaseLoadingModel');
    case LlamaCppModelLaunchLogPhase.WaitingReady:
      return i18nService.t('localInferenceModelLaunchPhaseWaitingReady');
    case LlamaCppModelLaunchLogPhase.ProbingModel:
      return i18nService.t('localInferenceModelLaunchPhaseProbingModel');
    case LlamaCppModelLaunchLogPhase.Retrying:
      return i18nService.t('localInferenceModelLaunchPhaseRetrying');
    case LlamaCppModelLaunchLogPhase.Succeeded:
      return i18nService.t('localInferenceModelLaunchPhaseSucceeded');
    case LlamaCppModelLaunchLogPhase.Failed:
      return i18nService.t('localInferenceModelLaunchPhaseFailed');
  }
}

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}
