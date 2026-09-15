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

export function useModelInspectorLaunchLogs(modelName: string, enabled: boolean) {
  const [state, setState] = useState<ModelInspectorLaunchLogsState>(initialState);
  const readVersionRef = useRef(0);
  const readTimerRef = useRef<number | null>(null);

  const readSessionLog = useCallback(async (sessionId: string) => {
    const readVersion = readVersionRef.current + 1;
    readVersionRef.current = readVersion;
    try {
      const result = await window.electron.llamacpp.readModelLaunchLogFile({ sessionId });
      if (readVersion !== readVersionRef.current) return;
      setState(current => ({
        ...current,
        session: result.success ? result.session ?? null : null,
        content: result.success ? result.content ?? '' : '',
        loading: false,
        error: result.success
          ? null
          : i18nService.t('localInferenceModelLaunchLogWindowReadFailed'),
      }));
    } catch {
      if (readVersion !== readVersionRef.current) return;
      setState(current => ({
        ...current,
        loading: false,
        error: i18nService.t('localInferenceModelLaunchLogWindowReadFailed'),
      }));
    }
  }, []);

  const refreshLatestSession = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const session = await window.electron.llamacpp.getLatestModelLaunchLogSession({ modelName });
      if (!session) {
        setState({ session: null, content: '', loading: false, error: null });
        return;
      }
      await readSessionLog(session.sessionId);
    } catch {
      setState(current => ({
        ...current,
        loading: false,
        error: i18nService.t('localInferenceModelLaunchLogWindowReadFailed'),
      }));
    }
  }, [modelName, readSessionLog]);

  useEffect(() => {
    readVersionRef.current += 1;
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
      setState(initialState);
    });
    return () => {
      unsubscribeLog();
      unsubscribeCleared();
      if (readTimerRef.current !== null) {
        window.clearTimeout(readTimerRef.current);
        readTimerRef.current = null;
      }
    };
  }, [enabled, modelName, refreshLatestSession]);

  return state;
}
