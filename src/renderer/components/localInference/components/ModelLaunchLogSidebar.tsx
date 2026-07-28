import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { LocalInferenceLogViewer } from './LocalInferenceLogViewer';
import { cn } from '@shared/lib/utils';
import { Download, X } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useState } from 'react';

import type { LlamaCppModelLaunchLogEvent } from '../../../../shared/llamacpp';
import {
  LlamaCppModelLaunchLogLevel,
  LlamaCppModelLaunchLogPhase,
} from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import { LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS } from '../constants';
import type { ModelLaunchLogPanelState } from '../hooks/useModelLaunchLogs';
import { ModelLaunchLogPanelStatus } from '../hooks/useModelLaunchLogs';

const MODEL_LAUNCH_LOG_SIDEBAR_MIN_WIDTH = 300;
const MODEL_LAUNCH_LOG_SIDEBAR_MAX_WIDTH = 720;
const MODEL_LAUNCH_LOG_MAIN_CONTENT_MIN_WIDTH = 520;
const MODEL_LAUNCH_LOG_DETAIL_SEPARATOR = ' ';

const LlamaCppProcessLogMessage = {
  Stdout: 'llama-server stdout',
  Stderr: 'llama-server stderr',
} as const;

type ProcessOutputLogDetail = {
  text: string;
  stream?: string;
  pid?: number;
};

export function ModelLaunchLogSidebar({
  state,
  onClose,
}: {
  state: ModelLaunchLogPanelState;
  onClose: () => void;
}) {
  const [isPresent, setIsPresent] = useState(state.visible);
  const [isEntered, setIsEntered] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(getMaxSidebarWidth);

  useEffect(() => {
    if (state.visible) {
      setSidebarWidth(getMaxSidebarWidth());
      setIsPresent(true);
      const frame = window.requestAnimationFrame(() => {
        setIsEntered(true);
      });

      return () => window.cancelAnimationFrame(frame);
    }

    setIsEntered(false);
    const timeout = window.setTimeout(() => {
      setIsPresent(false);
    }, LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS);

    return () => window.clearTimeout(timeout);
  }, [state.visible]);

  const isPanelEntered = state.visible && isEntered;
  const isPanelPresent = state.visible || isPresent;
  const handleDownloadLogs = () => {
    if (state.logs.length === 0) return;

    const content = formatLaunchLogsAsText(state);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = getLaunchLogDownloadFilename(state);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;

    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth + startX - moveEvent.clientX;
      setSidebarWidth(clampSidebarWidth(nextWidth));
    };

    const handlePointerEnd = () => {
      setIsResizing(false);
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
  };

  return (
    <aside
      aria-hidden={!state.visible}
      className={cn(
        'relative flex h-full shrink-0 border-l bg-background ease-in-out',
        'overflow-hidden transition-[width,border-color]',
        isPanelPresent ? 'border-border' : 'border-transparent',
      )}
      style={{
        width: isPanelEntered ? sidebarWidth : 0,
        transitionDuration: `${LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS}ms`,
      }}
    >
      {isPresent ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={i18nService.t('localInferenceModelLaunchLogsResize')}
          className={cn(
            'absolute inset-y-0 left-0 z-40 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center',
            'after:h-full after:w-px after:bg-transparent after:transition-colors after:duration-200 hover:after:bg-border',
            isResizing && 'after:bg-border',
          )}
          onPointerDown={handleResizePointerDown}
        />
      ) : null}
      {isPresent ? (
        <div
          className={cn(
            'flex h-full shrink-0 flex-col overflow-hidden transition-[transform,opacity] ease-in-out',
            isPanelEntered ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0',
          )}
          style={{
            width: sidebarWidth,
            transitionDuration: `${LOCAL_INFERENCE_MODEL_LAUNCH_LOG_TRANSITION_MS}ms`,
          }}
        >

          <div className="min-h-0 flex-1 overflow-hidden p-2">
            <LocalInferenceLogViewer
              toolbar={<ModelLaunchLogSidebarToolbar
                state={state}
                onDownloadLogs={handleDownloadLogs}
                onClose={onClose}
              />}
              key={state.sessionId ?? state.modelName ?? 'local-inference-log'}
              text={getLogOutput(state)}
              className="h-full rounded-none border-0"
            />

          </div>
        </div>
      ) : null}
    </aside>
  );
}

function ModelLaunchLogSidebarToolbar({
  state,
  onDownloadLogs,
  onClose,
}: {
  state: ModelLaunchLogPanelState;
  onDownloadLogs: () => void;
  onClose: () => void;
}) {
  return (
    <header className="draggable flex h-12 min-w-0 flex-1 items-center justify-between gap-3 border-b border-border px-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-semibold leading-6 text-foreground">
            {i18nService.t('localInferenceModelLaunchLogs')}
          </h2>
          <LaunchStatusBadge status={state.status} />
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {state.modelName
            ? i18nService.t('localInferenceModelLaunchLogsForModel').replace('{name}', state.modelName)
            : i18nService.t('localInferenceModelLaunchLogsWaiting')}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={i18nService.t('localInferenceModelLaunchLogsDownload')}
          disabled={state.logs.length === 0}
          onClick={onDownloadLogs}
        >
          <Download />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={i18nService.t('close')}
          data-local-inference-launch-close-button="true"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
    </header>
  );
}
function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(width, MODEL_LAUNCH_LOG_SIDEBAR_MIN_WIDTH), getMaxSidebarWidth());
}

function getMaxSidebarWidth(): number {
  if (typeof window === 'undefined') return MODEL_LAUNCH_LOG_SIDEBAR_MAX_WIDTH;

  return Math.max(
    MODEL_LAUNCH_LOG_SIDEBAR_MIN_WIDTH,
    Math.min(
      MODEL_LAUNCH_LOG_SIDEBAR_MAX_WIDTH,
      window.innerWidth - MODEL_LAUNCH_LOG_MAIN_CONTENT_MIN_WIDTH,
    ),
  );
}

function LaunchStatusBadge({ status }: { status: ModelLaunchLogPanelStatus }) {
  return (
    <Badge
      variant="outline"
      data-local-inference-launch-status={status}
    >
      {getLaunchStatusLabel(status)}
    </Badge>
  );
}

function getLaunchStatusLabel(status: ModelLaunchLogPanelStatus): string {
  switch (status) {
    case ModelLaunchLogPanelStatus.Idle:
      return i18nService.t('localInferenceModelLaunchNotStarted');
    case ModelLaunchLogPanelStatus.Starting:
      return i18nService.t('localInferenceModelLaunchStarting');
    case ModelLaunchLogPanelStatus.Succeeded:
      return i18nService.t('localInferenceModelLaunchSucceeded');
    case ModelLaunchLogPanelStatus.Failed:
      return i18nService.t('localInferenceModelLaunchFailed');
  }
}

function getLogOutput(state: ModelLaunchLogPanelState): string {
  if (state.logs.length === 0) return i18nService.t('localInferenceModelLaunchLogsWaiting');
  return formatLaunchLogsAsText(state);
}

function formatLaunchLogsAsText(state: ModelLaunchLogPanelState): string {
  return state.logs.map(formatLaunchLogDisplayLine).join('\n') + '\n';
}

function getLaunchLogDownloadFilename(state: ModelLaunchLogPanelState): string {
  const modelName = sanitizeDownloadFilenamePart(state.modelName ?? 'model');
  const timestamp = formatDownloadTimestamp(new Date());
  return `model-launch-log-${modelName}-${timestamp}.txt`;
}

function sanitizeDownloadFilenamePart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'model';
}

function formatDownloadTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + '-' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function formatLaunchLogDisplayLine(log: LlamaCppModelLaunchLogEvent): string {
  const processOutput = getProcessOutputLogDetail(log);
  const date = normalizeLogDate(log.createdAt);
  const processSegment = processOutput?.pid ? ` - ${processOutput.pid}` : '';
  const moduleName = processOutput
    ? getProcessOutputLogModuleName(log.message)
    : getLogModuleName(log.phase);

  return [
    `${formatLogTimestamp(date)}${processSegment}`,
    moduleName,
    getRawLogLevelName(log.level),
    getLaunchLogBody(log, processOutput),
  ].join(' - ');
}

function getLaunchLogBody(
  log: LlamaCppModelLaunchLogEvent,
  processOutput: ProcessOutputLogDetail | null,
): string {
  if (processOutput) return processOutput.text;

  const message = log.message?.trim() || getDefaultLogMessage(log.phase);
  const detail = log.detail?.trim();
  return detail ? `${message}${MODEL_LAUNCH_LOG_DETAIL_SEPARATOR}${detail}` : message;
}

function getProcessOutputLogDetail(log: LlamaCppModelLaunchLogEvent): ProcessOutputLogDetail | null {
  if (!isProcessOutputLogMessage(log.message)) return null;
  const detail = log.detail?.trim();
  if (!detail) return null;

  try {
    const parsed: unknown = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object') return { text: detail };

    const record = parsed as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (!text) return { text: detail };

    return {
      text,
      ...(typeof record.stream === 'string' ? { stream: record.stream } : {}),
      ...(typeof record.pid === 'number' ? { pid: record.pid } : {}),
    };
  } catch {
    return { text: detail };
  }
}

function isProcessOutputLogMessage(message: string | undefined): boolean {
  return message === LlamaCppProcessLogMessage.Stdout || message === LlamaCppProcessLogMessage.Stderr;
}

function getProcessOutputLogModuleName(message: string | undefined): string {
  if (message === LlamaCppProcessLogMessage.Stderr) return 'local_inference.server.stderr';
  return 'local_inference.server.stdout';
}

function getLogModuleName(phase: LlamaCppModelLaunchLogEvent['phase']): string {
  switch (phase) {
    case LlamaCppModelLaunchLogPhase.CheckingService:
    case LlamaCppModelLaunchLogPhase.StartingService:
    case LlamaCppModelLaunchLogPhase.ServiceReady:
      return 'local_inference.service';
    case LlamaCppModelLaunchLogPhase.CheckingRuntime:
      return 'local_inference.runtime';
    case LlamaCppModelLaunchLogPhase.Requested:
      return 'local_inference.launch';
    case LlamaCppModelLaunchLogPhase.PreparingModel:
    case LlamaCppModelLaunchLogPhase.LoadingModel:
    case LlamaCppModelLaunchLogPhase.WaitingReady:
    case LlamaCppModelLaunchLogPhase.ProbingModel:
    case LlamaCppModelLaunchLogPhase.Retrying:
    case LlamaCppModelLaunchLogPhase.Succeeded:
    case LlamaCppModelLaunchLogPhase.Failed:
      return 'local_inference.model';
  }
}

function getDefaultLogMessage(phase: LlamaCppModelLaunchLogEvent['phase']): string {
  switch (phase) {
    case LlamaCppModelLaunchLogPhase.Requested:
      return 'Startup request received';
    case LlamaCppModelLaunchLogPhase.CheckingService:
      return 'Checking local inference service';
    case LlamaCppModelLaunchLogPhase.StartingService:
      return 'Starting local inference service';
    case LlamaCppModelLaunchLogPhase.ServiceReady:
      return 'Local inference service is ready';
    case LlamaCppModelLaunchLogPhase.PreparingModel:
      return 'Preparing model configuration';
    case LlamaCppModelLaunchLogPhase.CheckingRuntime:
      return 'Checking runtime environment';
    case LlamaCppModelLaunchLogPhase.LoadingModel:
      return 'Loading model';
    case LlamaCppModelLaunchLogPhase.WaitingReady:
      return 'Waiting for model readiness';
    case LlamaCppModelLaunchLogPhase.ProbingModel:
      return 'Testing model response';
    case LlamaCppModelLaunchLogPhase.Retrying:
      return 'Retrying model startup';
    case LlamaCppModelLaunchLogPhase.Succeeded:
      return 'Model started successfully';
    case LlamaCppModelLaunchLogPhase.Failed:
      return 'Model startup failed';
  }
}

function getRawLogLevelName(level: LlamaCppModelLaunchLogEvent['level']): string {
  switch (level) {
    case LlamaCppModelLaunchLogLevel.Error:
      return 'ERROR';
    case LlamaCppModelLaunchLogLevel.Warn:
      return 'WARNING';
    case LlamaCppModelLaunchLogLevel.Debug:
      return 'DEBUG';
    case LlamaCppModelLaunchLogLevel.Info:
      return 'INFO';
  }
}

function normalizeLogDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date;
  return new Date();
}

function formatLogTimestamp(date: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  const timezoneOffsetMinutes = -date.getTimezoneOffset();
  const timezoneSign = timezoneOffsetMinutes >= 0 ? '+' : '-';
  const absoluteTimezoneOffset = Math.abs(timezoneOffsetMinutes);
  const timezoneHours = pad(Math.floor(absoluteTimezoneOffset / 60));
  const timezoneMinutes = pad(absoluteTimezoneOffset % 60);

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}000${timezoneSign}${timezoneHours}:${timezoneMinutes}`,
  ].join(' ');
}

