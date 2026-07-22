import { Button } from '@shared/components/ui/button';
import { Progress, ProgressValue } from '@shared/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';
import { MessageCircle, Minimize2, TriangleAlert } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import type { OpenClawEngineStatus } from '../../types/cowork';

const resolveEngineStatusText = (status: OpenClawEngineStatus): string => {
  switch (status.phase) {
    case 'not_installed':
      return i18nService.t('coworkOpenClawNotInstalledNotice');
    case 'installing':
      return i18nService.t('coworkOpenClawInstalling');
    case 'ready':
      return i18nService.t('coworkOpenClawReadyNotice');
    case 'starting':
    case 'compiling':
      return status.message || i18nService.t('coworkOpenClawStarting');
    case 'error':
      return status.message || i18nService.t('coworkOpenClawError');
    case 'running':
    default:
      return i18nService.t('coworkOpenClawRunning');
  }
};

const HIDE_DELAY_MS = 600;

/**
 * Non-blocking floating popup shown when the OpenClaw gateway is starting or in error.
 */
const EngineStartupOverlay: React.FC = () => {
  const [status, setStatus] = useState<OpenClawEngineStatus | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stickyStatusRef = useRef<OpenClawEngineStatus | null>(null);
  const [visible, setVisible] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return clearHideTimer;
  }, [clearHideTimer]);

  useEffect(() => {
    coworkService.getOpenClawEngineStatus().then(s => {
      if (!s) return;

      setStatus(s);
      const shouldShow = s.phase === 'starting' || s.phase === 'compiling' || s.phase === 'error';
      if (shouldShow) {
        stickyStatusRef.current = s;
        if (s.phase === 'error') setIsCollapsed(false);
        setVisible(true);
      }
    });

    const unsubscribe = coworkService.onOpenClawEngineStatus(s => {
      setStatus(s);

      const shouldShow = s.phase === 'starting' || s.phase === 'compiling' || s.phase === 'error';

      if (shouldShow) {
        clearHideTimer();
        stickyStatusRef.current = s;
        if (s.phase === 'error') setIsCollapsed(false);
        setVisible(true);
      } else if (s.phase === 'running') {
        clearHideTimer();
        hideTimerRef.current = setTimeout(() => {
          stickyStatusRef.current = null;
          setIsCollapsed(false);
          setVisible(false);
        }, HIDE_DELAY_MS);
      }
    });

    return unsubscribe;
  }, [clearHideTimer]);

  const retry = useCallback(() => {
    coworkService.restartOpenClawGateway().catch(() => {
      /* handled by status event */
    });
  }, []);

  const displayStatus =
    status &&
    (status.phase === 'starting' || status.phase === 'compiling' || status.phase === 'error')
      ? status
      : stickyStatusRef.current;

  if (!visible || !displayStatus) {
    return null;
  }

  const isStarting = displayStatus.phase === 'starting' || displayStatus.phase === 'compiling';
  const isError = displayStatus.phase === 'error';

  const progressPercent =
    typeof displayStatus.progressPercent === 'number'
      ? Math.max(0, Math.min(100, Math.round(displayStatus.progressPercent)))
      : null;

  const tone = isError
    ? {
        Icon: TriangleAlert,
        iconClass: 'bg-destructive/10 text-destructive',
        messageClass: 'text-destructive',
      }
    : {
        Icon: MessageCircle,
        iconClass: 'bg-primary/10 text-primary',
        messageClass: 'text-foreground',
      };

  const compactProgressPercent = progressPercent ?? 0;

  const element = (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-9999 flex justify-center">
      {isCollapsed && isStarting ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="pointer-events-auto mt-2 inline-flex">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCollapsed(false)}
                  className="h-9 w-36 justify-start gap-2 px-2 shadow-lg"
                  aria-label={i18nService.t('expand')}
                >
                  <MessageCircle data-icon="inline-start" />
                  <Progress value={compactProgressPercent} className="min-w-0 flex-1" />
                </Button>
              </span>
            }
          />
          <TooltipContent>{resolveEngineStatusText(displayStatus)}</TooltipContent>
        </Tooltip>
      ) : (
        <div className="pointer-events-auto mt-2 w-full max-w-sm animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden rounded-lg border border-border bg-background shadow-lg">
          <div className="flex items-start gap-3 px-4 py-3">
            <span
              className={cn(
                'inline-flex size-8 shrink-0 items-center justify-center rounded-full',
                tone.iconClass,
                isStarting && 'animate-pulse',
              )}
            >
              <tone.Icon className="h-4 w-4" />
            </span>

            <div className={`min-w-0 flex-1 text-sm leading-6 ${tone.messageClass}`}>
              <div>{resolveEngineStatusText(displayStatus)}</div>
              {progressPercent !== null && isStarting && (
                <div className="mt-1">
                  <Progress value={progressPercent}>
                    <ProgressValue />
                  </Progress>
                </div>
              )}
              {isError && (
                <div className="mt-0.5 text-xs text-destructive">
                  {i18nService.t('coworkOpenClawErrorHint') || '请检查网络连接或重试'}
                </div>
              )}
            </div>
            {isStarting && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setIsCollapsed(true)}
                        aria-label={i18nService.t('collapse')}
                      >
                        <Minimize2 />
                      </Button>
                    </span>
                  }
                />
                <TooltipContent>{i18nService.t('collapse')}</TooltipContent>
              </Tooltip>
            )}
          </div>

          {isError && (
            <div className="flex justify-end gap-2 border-t border-border bg-surface/40 px-4 py-2">
              <Button variant="secondary" size="sm" onClick={retry}>
                {i18nService.t('retry') || '重试'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(element, document.body);
};

export default EngineStartupOverlay;

export function useGatewayReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    coworkService.getOpenClawEngineStatus().then(s => {
      setReady(s?.phase === 'running');
    });

    const unsubscribe = coworkService.onOpenClawEngineStatus(s => {
      setReady(s.phase === 'running');
    });

    return unsubscribe;
  }, []);

  return ready;
}
