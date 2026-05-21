import { ChatBubbleLeftRightIcon, ChevronDownIcon, ChevronUpIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useState } from 'react';

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

/**
 * Non-blocking top banner shown when the OpenClaw gateway is starting or in error.
 *
 * Unlike the previous full-screen overlay, this banner allows the user to:
 * - Browse conversation history
 * - Switch to other sessions/tabs
 * - Open Settings
 * - Use IM features
 *
 * Only the message send button is disabled during startup (handled in CoworkPromptInput).
 */
const EngineStartupOverlay: React.FC = () => {
  const [status, setStatus] = useState<OpenClawEngineStatus | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    coworkService.getOpenClawEngineStatus().then((s) => {
      if (s) setStatus(s);
    });

    const unsubscribe = coworkService.onOpenClawEngineStatus((s) => {
      setStatus(s);
      // Auto-expand on error
      if (s.phase === 'error') {
        setCollapsed(false);
      }
    });

    return unsubscribe;
  }, []);

  const dismiss = useCallback(() => {
    setCollapsed(true);
  }, []);

  const expand = useCallback(() => {
    setCollapsed(false);
  }, []);

  const retry = useCallback(() => {
    coworkService.restartOpenClawGateway().catch(() => { /* handled by status event */ });
  }, []);

  const isStarting = status?.phase === 'starting' || status?.phase === 'compiling';
  const isError = status?.phase === 'error';

  if (!status || (!isStarting && !isError)) {
    return null;
  }

  const progressPercent = typeof status.progressPercent === 'number'
    ? Math.max(0, Math.min(100, Math.round(status.progressPercent)))
    : null;

  if (collapsed && isStarting) {
    return (
      <div className="absolute top-0 left-0 right-0 z-[50]">
        <button
          onClick={expand}
          className="mx-auto mt-1 flex items-center gap-1.5 rounded-b-lg bg-primary-muted/80 px-3 py-1 text-xs text-primary hover:bg-primary-muted transition-colors"
          aria-label={i18nService.t('coworkOpenClawStartingNoticeExpand') || '展开网关状态'}
        >
          <ChatBubbleLeftRightIcon className="h-3 w-3 animate-pulse" />
          <span>{i18nService.t('coworkOpenClawStartingNoticeShort') || '网关启动中...'}</span>
          <ChevronDownIcon className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`absolute top-0 left-0 right-0 z-[50] border-b transition-colors ${
        isError
          ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950'
          : 'border-primary/20 bg-primary-muted'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Icon */}
        <div
          className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
            isError
              ? 'bg-red-200 text-red-700 dark:bg-red-800 dark:text-red-300'
              : 'bg-primary/15 text-primary animate-pulse'
          }`}
        >
          {isError ? (
            <ExclamationTriangleIcon className="h-4 w-4" />
          ) : (
            <ChatBubbleLeftRightIcon className="h-4 w-4" />
          )}
        </div>

        {/* Message + Progress */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">
            {resolveEngineStatusText(status)}
          </div>
          {progressPercent !== null && isStarting && (
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 flex-1 max-w-[200px] rounded-full bg-primary/15 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-xs text-secondary">{progressPercent}%</span>
            </div>
          )}
          {isError && (
            <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">
              {i18nService.t('coworkOpenClawErrorHint') || '请检查网络连接或重试'}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isError && (
            <button
              onClick={retry}
              className="text-xs font-medium px-2.5 py-1 rounded-lg bg-red-200 text-red-700 hover:bg-red-300 dark:bg-red-800 dark:text-red-300 dark:hover:bg-red-700 transition-colors"
            >
              {i18nService.t('retry') || '重试'}
            </button>
          )}
          {isStarting && (
            <button
              onClick={dismiss}
              className="text-xs text-secondary hover:text-foreground px-1.5 py-0.5 rounded transition-colors"
              aria-label={i18nService.t('collapse') || '收起'}
              title={i18nService.t('coworkOpenClawStartingNoticeDismiss') || '收起通知'}
            >
              <ChevronUpIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default EngineStartupOverlay;

/**
 * Hook for other components to react to gateway readiness.
 */
export function useGatewayReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    coworkService.getOpenClawEngineStatus().then((s) => {
      setReady(s?.phase === 'running');
    });

    const unsubscribe = coworkService.onOpenClawEngineStatus((s) => {
      setReady(s.phase === 'running');
    });

    return unsubscribe;
  }, []);

  return ready;
}
