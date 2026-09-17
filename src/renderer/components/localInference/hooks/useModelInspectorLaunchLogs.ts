import { useCallback, useEffect, useRef, useState } from 'react';

import type { LlamaCppModelLaunchLogSession } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';

export type ModelInspectorLaunchLogsState = {
  session: LlamaCppModelLaunchLogSession | null;
  content: string;
  loading: boolean;
  error: string | null;
};

const initialState: ModelInspectorLaunchLogsState = {
  session: null,
  content: '',
  loading: false,
  error: null,
};

const LOG_REFRESH_INTERVAL_MS = 750;

export function useModelInspectorLaunchLogs(modelName: string, enabled: boolean) {
  const [state, setState] = useState<ModelInspectorLaunchLogsState>(initialState);
  const readVersionRef = useRef(0);
  const readTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const offsetRef = useRef(0);

  const refreshOnce = useCallback(async () => {
    const readVersion = readVersionRef.current;
    if (!sessionIdRef.current) {
      setState(current => ({ ...current, loading: true, error: null }));
    }

    try {
      const session = await window.electron.llamacpp.getLatestModelLaunchLogSession({ modelName });
      if (readVersion !== readVersionRef.current) return;
      if (!session) {
        sessionIdRef.current = null;
        offsetRef.current = 0;
        setState(initialState);
        return;
      }

      const isSameSession = sessionIdRef.current === session.sessionId;
      const requestedOffset = isSameSession ? offsetRef.current : 0;
      const result = await window.electron.llamacpp.readModelLaunchLogFile({
        sessionId: session.sessionId,
        ...(requestedOffset > 0 ? { offset: requestedOffset } : {}),
      });
      if (readVersion !== readVersionRef.current) return;
      const resultSession = result.session;
      if (!result.success || !resultSession) {
        sessionIdRef.current = null;
        offsetRef.current = 0;
        setState(current => ({
          ...current,
          loading: false,
          error: i18nService.t('localInferenceModelLaunchLogWindowReadFailed'),
        }));
        return;
      }

      const startOffset = result.startOffset ?? 0;
      const isIncrementalRead =
        isSameSession && requestedOffset > 0 && startOffset === requestedOffset;
      sessionIdRef.current = resultSession.sessionId;
      offsetRef.current = result.nextOffset ?? 0;
      setState(current => ({
        ...current,
        session: resultSession,
        content: isIncrementalRead
          ? `${current.content}${result.content ?? ''}`
          : (result.content ?? ''),
        loading: false,
        error: null,
      }));
    } catch {
      if (readVersion !== readVersionRef.current) return;
      setState(current => ({
        ...current,
        loading: false,
        error: i18nService.t('localInferenceModelLaunchLogWindowReadFailed'),
      }));
    }
  }, [modelName]);

  const refreshLatestSession = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }

    refreshInFlightRef.current = true;
    try {
      do {
        refreshQueuedRef.current = false;
        await refreshOnce();
      } while (refreshQueuedRef.current);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [refreshOnce]);

  useEffect(() => {
    readVersionRef.current += 1;
    refreshQueuedRef.current = false;
    sessionIdRef.current = null;
    offsetRef.current = 0;
    if (readTimerRef.current !== null) window.clearTimeout(readTimerRef.current);
    setState(initialState);
    if (!enabled || !modelName) return;
    void refreshLatestSession();
  }, [enabled, modelName, refreshLatestSession]);

  useEffect(() => {
    if (!enabled || !modelName) return;
    const scheduleRefresh = () => {
      if (readTimerRef.current !== null) window.clearTimeout(readTimerRef.current);
      readTimerRef.current = window.setTimeout(() => {
        readTimerRef.current = null;
        void refreshLatestSession();
      }, 120);
    };
    const unsubscribeLog = window.electron.llamacpp.onModelLaunchLog(event => {
      if (event.modelName === modelName) scheduleRefresh();
    });
    const unsubscribeCleared = window.electron.llamacpp.onModelLaunchLogCleared(event => {
      if (event.modelName !== modelName) return;
      readVersionRef.current += 1;
      refreshQueuedRef.current = false;
      sessionIdRef.current = null;
      offsetRef.current = 0;
      setState(initialState);
    });
    const interval = window.setInterval(() => {
      void refreshLatestSession();
    }, LOG_REFRESH_INTERVAL_MS);
    return () => {
      unsubscribeLog();
      unsubscribeCleared();
      if (readTimerRef.current !== null) {
        window.clearTimeout(readTimerRef.current);
        readTimerRef.current = null;
      }
      window.clearInterval(interval);
    };
  }, [enabled, modelName, refreshLatestSession]);

  return state;
}
