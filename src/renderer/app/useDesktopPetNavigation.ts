import { useEffect, useRef, useState } from 'react';

import { DesktopPetTaskResult } from '../../shared/desktopPet/constants';
import type { DesktopPetTaskOpen } from '../../shared/desktopPet/types';
import { coworkService } from '../services/cowork';
import { workspaceService } from '../services/workspace';
import { i18nService } from '../services/i18n';
import { showAppError } from '../services/appToast';
import { store } from '../store';
import { WorkMode } from '../store/workMode/constants';
import { setWorkMode } from '../store/workMode/workModeSlice';
import { MainView } from './constants';

export function useDesktopPetNavigation(
  initialized: boolean,
  mainView: MainView,
  currentSessionId: string | null,
  showCowork: () => void,
): void {
  const latest = useRef(0);
  const [opened, setOpened] = useState<DesktopPetTaskOpen | null>(null);
  useEffect(() => {
    const api = window.electron.desktopPet;
    if (!initialized || !api) return;
    latest.current = 0;
    let active = true;
    const open = async (request: DesktopPetTaskOpen) => {
      if (!active || request.requestId <= latest.current) return;
      latest.current = request.requestId;
      try {
        // A task created in the bubble may belong to a newly selected folder.
        await workspaceService.refreshWorkspaces();
        if (!active || latest.current !== request.requestId) return;
        const session = await coworkService.loadSession(request.sessionId);
        if (!active || latest.current !== request.requestId) return;
        if (!session) {
          // A transport failure must not be mistaken for an explicitly missing session.
          const check = await window.electron.cowork.getSession(request.sessionId, {
            messageLimit: 0,
          });
          await api.resolveTask(
            request.requestId,
            check.success && check.session === null
              ? DesktopPetTaskResult.Missing
              : DesktopPetTaskResult.Failed,
          );
          showAppError(i18nService.t('desktopPetTaskOpenFailed'));
          return;
        }
        if (store.getState().cowork.currentSessionId !== request.sessionId) {
          await api.resolveTask(request.requestId, DesktopPetTaskResult.Failed);
          return;
        }
        store.dispatch(setWorkMode(session.mode === WorkMode.Chat ? WorkMode.Chat : WorkMode.Work));
        setOpened(request);
        showCowork();
      } catch {
        if (active && latest.current === request.requestId) {
          void api
            .resolveTask(request.requestId, DesktopPetTaskResult.Failed)
            .catch(() => undefined);
          showAppError(i18nService.t('desktopPetTaskOpenFailed'));
        }
      }
    };
    const unsubscribe = api.onOpenTask(request => void open(request));
    void api
      .getPendingTask()
      .then(request => {
        if (request) void open(request);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [initialized, showCowork]);

  useEffect(() => {
    if (!opened || mainView !== MainView.Cowork || currentSessionId !== opened.sessionId) return;
    const frame = requestAnimationFrame(() => {
      if (
        latest.current !== opened.requestId ||
        store.getState().cowork.currentSessionId !== opened.sessionId
      )
        return;
      void window.electron.desktopPet
        .resolveTask(opened.requestId, DesktopPetTaskResult.Opened)
        .catch(() => undefined);
      setOpened(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [currentSessionId, mainView, opened]);
}
