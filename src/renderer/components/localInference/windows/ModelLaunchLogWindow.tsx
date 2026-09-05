import { Badge } from '@shared/components/ui/badge';
import { LocalInferenceLogViewer } from '../components/LocalInferenceLogViewer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  LlamaCppModelLaunchLogClearedEvent,
  LlamaCppModelLaunchLogEvent,
  LlamaCppModelLaunchLogSession,
  LlamaCppModelLaunchLogWindowTarget,
} from '../../../../shared/llamacpp';
import {
  LlamaCppModelLaunchLogSessionStatus,
  LlamaCppModelLaunchLogWindowQuery,
} from '../../../../shared/llamacpp';
import logIconUrl from '../../../assets/localInference/log.svg';
import { configService } from '../../../services/config';
import { i18nService } from '../../../services/i18n';
import { themeService } from '../../../services/theme';

type ModelLaunchLogWindowState = {
  sessionId: string | null;
  modelName: string | null;
  session: LlamaCppModelLaunchLogSession | null;
  content: string;
  loading: boolean;
  error: string | null;
};

export function ModelLaunchLogWindow() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialSessionId = params.get(LlamaCppModelLaunchLogWindowQuery.SessionId);
  const initialModelName = params.get(LlamaCppModelLaunchLogWindowQuery.ModelName);
  const [, forceLanguageRefresh] = useState(0);
  const [state, setState] = useState<ModelLaunchLogWindowState>({
    sessionId: initialSessionId,
    modelName: initialModelName,
    session: null,
    content: '',
    loading: true,
    error: null,
  });
  const readVersionRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      await configService.init();
      themeService.initialize();
      await i18nService.initialize();
      if (mounted) forceLanguageRefresh(value => value + 1);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const readSessionLog = useCallback(async (sessionId: string) => {
    const readVersion = readVersionRef.current + 1;
    readVersionRef.current = readVersion;
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const result = await window.electron.llamacpp.readModelLaunchLogFile({ sessionId });
      if (readVersion !== readVersionRef.current) return;
      if (!result.success || !result.session) {
        setState(current => ({
          ...current,
          loading: false,
          error: i18nService.t('localInferenceModelLaunchLogWindowSessionNotFound'),
        }));
        return;
      }

      setState(current => ({
        ...current,
        sessionId: result.session?.sessionId ?? sessionId,
        modelName: result.session?.modelName ?? current.modelName,
        session: result.session ?? null,
        content: result.content ?? '',
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
  }, []);

  const resolveLatestSession = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: null }));
    try {
      const session = await window.electron.llamacpp.getLatestModelLaunchLogSession(
        state.modelName ? { modelName: state.modelName } : undefined,
      );
      if (!session) {
        setState(current => ({ ...current, loading: false }));
        return;
      }

      setState(current => ({
        ...current,
        sessionId: session.sessionId,
        modelName: session.modelName,
        session,
      }));
      await readSessionLog(session.sessionId);
    } catch {
      setState(current => ({
        ...current,
        loading: false,
        error: i18nService.t('localInferenceModelLaunchLogWindowReadFailed'),
      }));
    }
  }, [readSessionLog, state.modelName]);

  useEffect(() => {
    if (state.sessionId) {
      void readSessionLog(state.sessionId);
      return;
    }
    void resolveLatestSession();
  }, [readSessionLog, resolveLatestSession, state.modelName, state.sessionId]);

  useEffect(() => {
    const unsubscribe = window.electron.llamacpp.onModelLaunchLogWindowTargetChanged(target => {
      const nextSessionId = normalizeOptionalTargetValue(target.sessionId);
      const nextModelName = normalizeOptionalTargetValue(target.modelName);
      setState(current => {
        const unchanged =
          current.sessionId === nextSessionId && current.modelName === nextModelName;
        return {
          ...current,
          sessionId: nextSessionId,
          modelName: nextModelName,
          session: unchanged ? current.session : null,
          content: unchanged ? current.content : '',
          loading: true,
          error: null,
        };
      });
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.llamacpp.onModelLaunchLogCleared(event => {
      setState(current => {
        if (!shouldClearLaunchLog(event, current.session, current.modelName)) return current;
        readVersionRef.current += 1;
        return {
          ...current,
          sessionId: null,
          modelName: current.modelName ?? event.modelName,
          session: null,
          content: '',
          loading: false,
          error: null,
        };
      });
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.llamacpp.onModelLaunchLog(event => {
      if (!shouldFollowLaunchLogEvent(event, state.sessionId, state.modelName)) return;
      setState(current => ({
        ...current,
        sessionId: event.sessionId,
        modelName: event.modelName,
      }));
      void readSessionLog(event.sessionId);
    });
    return () => unsubscribe();
  }, [readSessionLog, state.modelName, state.sessionId]);

  const windowTitle = i18nService.t('localInferenceModelLaunchLogWindowTitle');
  const pageTitle = state.modelName ?? windowTitle;

  useEffect(() => {
    document.title = windowTitle;
  }, [windowTitle]);

  const body = getWindowLogBody(state);
  const logOutput =
    body ||
    (state.loading
      ? i18nService.t('localInferenceModelLaunchLogWindowWaiting')
      : i18nService.t('localInferenceModelLaunchLogWindowEmpty'));

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <main className="flex min-h-0 flex-1 overflow-hidden p-4">
        <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-4">
          <LocalInferenceLogViewer
            toolbar={<ModelLaunchLogWindowToolbar pageTitle={pageTitle} state={state} />}
            key={state.sessionId ?? state.modelName ?? 'local-inference-log'}
            text={logOutput}
            className="min-h-0 flex-1"
          />
        </div>
      </main>
    </div>
  );
}

function ModelLaunchLogWindowToolbar({
  pageTitle,
  state,
}: {
  pageTitle: string;
  state: ModelLaunchLogWindowState;
}) {
  return (
    <header className="draggable flex h-12 min-w-0 flex-1 items-center justify-between gap-3 border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-3">
        <LogWindowAvatar compact />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{pageTitle}</h1>
        </div>
      </div>
      <LaunchWindowStatusBadge state={state} />
    </header>
  );
}
function LogWindowAvatar({ compact = false }: { compact?: boolean }) {
  const maskStyle = {
    WebkitMaskImage: `url("${logIconUrl}")`,
    WebkitMaskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    backgroundColor: 'currentColor',
    maskImage: `url("${logIconUrl}")`,
    maskPosition: 'center',
    maskRepeat: 'no-repeat',
    maskSize: 'contain',
  };

  return (
    <span
      className={
        compact
          ? 'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'
          : 'inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'
      }
    >
      <span
        aria-hidden="true"
        className={compact ? 'inline-block size-4' : 'inline-block size-6'}
        style={maskStyle}
      />
    </span>
  );
}

function normalizeOptionalTargetValue(
  value: LlamaCppModelLaunchLogWindowTarget[keyof LlamaCppModelLaunchLogWindowTarget],
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function shouldClearLaunchLog(
  event: LlamaCppModelLaunchLogClearedEvent,
  session: LlamaCppModelLaunchLogSession | null,
  modelName: string | null,
): boolean {
  if (modelName && event.modelName === modelName) return true;
  return Boolean(session && event.modelName === session.modelName);
}

function shouldFollowLaunchLogEvent(
  event: LlamaCppModelLaunchLogEvent,
  sessionId: string | null,
  modelName: string | null,
): boolean {
  if (sessionId) return event.sessionId === sessionId;
  if (modelName) return event.modelName === modelName;
  return true;
}

function LaunchWindowStatusBadge({ state }: { state: ModelLaunchLogWindowState }) {
  if (!state.session) {
    return (
      <Badge variant="secondary" className="theme-page-model-launch-log-window-badge-1">
        {i18nService.t('localInferenceModelLaunchNotStarted')}
      </Badge>
    );
  }

  if (state.session.status === LlamaCppModelLaunchLogSessionStatus.Succeeded) {
    return (
      <Badge variant="outline" className="theme-page-model-launch-log-window-badge-2">
        {i18nService.t('localInferenceModelLaunchSucceeded')}
      </Badge>
    );
  }
  if (state.session.status === LlamaCppModelLaunchLogSessionStatus.Failed) {
    return (
      <Badge variant="outline" className="theme-page-model-launch-log-window-badge-3">
        {i18nService.t('localInferenceModelLaunchFailed')}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="theme-page-model-launch-log-window-badge-4">
      {i18nService.t('localInferenceModelLaunchStarting')}
    </Badge>
  );
}

function getWindowLogBody(state: ModelLaunchLogWindowState): string {
  if (state.error) {
    return `${i18nService.t('localInferenceModelLaunchLogWindowReadFailed')}: ${state.error}`;
  }
  if (state.content.trim()) return state.content;
  return '';
}
