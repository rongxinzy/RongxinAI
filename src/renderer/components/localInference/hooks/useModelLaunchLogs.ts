import { useCallback, useEffect, useRef, useState } from 'react';

import type { LlamaCppModelLaunchLogEvent } from '../../../../shared/llamacpp';
import { LlamaCppModelLaunchLogPhase } from '../../../../shared/llamacpp';
import { LOCAL_INFERENCE_MODEL_LAUNCH_LOG_MAX_ENTRIES } from '../constants';

export const ModelLaunchLogPanelStatus = {
  Idle: 'idle',
  Starting: 'starting',
  Succeeded: 'succeeded',
  Failed: 'failed',
} as const;

export type ModelLaunchLogPanelStatus =
  (typeof ModelLaunchLogPanelStatus)[keyof typeof ModelLaunchLogPanelStatus];

export type ModelLaunchLogPanelState = {
  visible: boolean;
  status: ModelLaunchLogPanelStatus;
  sessionId: string | null;
  modelName: string | null;
  logs: LlamaCppModelLaunchLogEvent[];
};

const initialState: ModelLaunchLogPanelState = {
  visible: false,
  status: ModelLaunchLogPanelStatus.Idle,
  sessionId: null,
  modelName: null,
  logs: [],
};

export function useModelLaunchLogs() {
  const [state, setState] = useState<ModelLaunchLogPanelState>(initialState);
  const stateRef = useRef<ModelLaunchLogPanelState>(initialState);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const appendEvent = useCallback((event: LlamaCppModelLaunchLogEvent) => {
    if (!shouldAcceptLaunchLogEvent(stateRef.current, event)) return;

    setState(current => {
      const nextStatus = getStatusForEvent(event, current.status);
      const logs = mergeLaunchLogEvents(current.logs, event);

      return {
        ...current,
        status: nextStatus,
        sessionId: current.sessionId ?? event.sessionId,
        modelName: current.modelName ?? event.modelName,
        logs,
      };
    });
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.llamacpp.onModelLaunchLog(appendEvent);
    return () => {
      unsubscribe();
    };
  }, [appendEvent]);

  const beginModelLaunch = useCallback((
    modelName: string,
    options: { visible?: boolean } = {},
  ) => {
    const { visible = false } = options;
    setState({
      visible,
      status: ModelLaunchLogPanelStatus.Starting,
      sessionId: null,
      modelName,
      logs: [],
    });
  }, []);

  const markModelLaunchSucceeded = useCallback(() => {
    setState(current => ({
      ...current,
      status:
        current.status === ModelLaunchLogPanelStatus.Failed
          ? current.status
          : ModelLaunchLogPanelStatus.Succeeded,
    }));
  }, []);

  const markModelLaunchFailed = useCallback(() => {
    setState(current => ({
      ...current,
      status: ModelLaunchLogPanelStatus.Failed,
    }));
  }, []);

  const openPanelForModel = useCallback((modelName: string) => {
    setState(current => {
      if (current.modelName === modelName || !current.modelName) {
        return {
          ...current,
          visible: true,
          modelName,
        };
      }
      return {
        visible: true,
        status: ModelLaunchLogPanelStatus.Idle,
        sessionId: null,
        modelName,
        logs: [],
      };
    });
  }, []);

  const closePanel = useCallback(() => {
    setState(current => ({ ...current, visible: false }));
  }, []);

  return {
    state,
    beginModelLaunch,
    openPanelForModel,
    markModelLaunchSucceeded,
    markModelLaunchFailed,
    closePanel,
  };
}

export function shouldCloseLaunchLogPanelForModel(
  state: Pick<ModelLaunchLogPanelState, 'modelName'>,
  modelName: string,
): boolean {
  return state.modelName === modelName;
}

export function shouldAcceptLaunchLogEvent(
  state: ModelLaunchLogPanelState,
  event: Pick<LlamaCppModelLaunchLogEvent, 'sessionId' | 'modelName'>,
): boolean {
  if (state.sessionId) return state.sessionId === event.sessionId;
  if (state.modelName) return state.modelName === event.modelName;
  return true;
}

function mergeLaunchLogEvents(
  logs: LlamaCppModelLaunchLogEvent[],
  event: LlamaCppModelLaunchLogEvent,
): LlamaCppModelLaunchLogEvent[] {
  if (event.phase === LlamaCppModelLaunchLogPhase.Succeeded) {
    const existingSuccess = logs.find(log => log.phase === LlamaCppModelLaunchLogPhase.Succeeded);
    if (existingSuccess && hasLaunchLogText(existingSuccess) && !hasLaunchLogText(event)) {
      return logs;
    }
    return [
      ...logs.filter(log => log.phase !== LlamaCppModelLaunchLogPhase.Succeeded),
      event,
    ].slice(-LOCAL_INFERENCE_MODEL_LAUNCH_LOG_MAX_ENTRIES);
  }

  const previous = logs[logs.length - 1];
  if (previous && isSameRenderableLaunchLog(previous, event)) {
    return logs;
  }

  if (previous && previous.phase === event.phase && previous.level === event.level) {
    if (!hasLaunchLogText(previous) && hasLaunchLogText(event)) {
      return [...logs.slice(0, -1), event].slice(-LOCAL_INFERENCE_MODEL_LAUNCH_LOG_MAX_ENTRIES);
    }
    if (hasLaunchLogText(previous) && !hasLaunchLogText(event)) {
      return logs;
    }
  }

  return [...logs, event].slice(-LOCAL_INFERENCE_MODEL_LAUNCH_LOG_MAX_ENTRIES);
}

function isSameRenderableLaunchLog(
  first: LlamaCppModelLaunchLogEvent,
  second: LlamaCppModelLaunchLogEvent,
): boolean {
  return (
    first.level === second.level &&
    first.phase === second.phase &&
    getLaunchLogText(first) === getLaunchLogText(second)
  );
}

function hasLaunchLogText(event: LlamaCppModelLaunchLogEvent): boolean {
  return getLaunchLogText(event).length > 0;
}

function getLaunchLogText(event: LlamaCppModelLaunchLogEvent): string {
  return (event.detail ?? '').trim();
}

function getStatusForEvent(
  event: LlamaCppModelLaunchLogEvent,
  currentStatus: ModelLaunchLogPanelStatus,
): ModelLaunchLogPanelStatus {
  if (event.phase === LlamaCppModelLaunchLogPhase.Succeeded) {
    return ModelLaunchLogPanelStatus.Succeeded;
  }
  if (event.phase === LlamaCppModelLaunchLogPhase.Failed) {
    return ModelLaunchLogPanelStatus.Failed;
  }
  if (currentStatus === ModelLaunchLogPanelStatus.Idle) {
    return ModelLaunchLogPanelStatus.Starting;
  }
  return currentStatus;
}
