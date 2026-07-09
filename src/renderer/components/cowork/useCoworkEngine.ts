import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';

import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { quickActionService } from '../../services/quickAction';
import { setActions } from '../../store/slices/quickActionSlice';
import type { OpenClawEngineStatus } from '../../types/cowork';

export function useCoworkEngine() {
  const dispatch = useDispatch();
  const [isInitialized, setIsInitialized] = useState(false);
  const [openClawStatus, setOpenClawStatus] = useState<OpenClawEngineStatus | null>(null);
  const [isRestartingGateway, setIsRestartingGateway] = useState(false);

  useEffect(() => {
    const init = async () => {
      await coworkService.init();
      const initialEngineStatus = await coworkService.getOpenClawEngineStatus();
      if (initialEngineStatus) setOpenClawStatus(initialEngineStatus);
      try { quickActionService.initialize(); const actions = await quickActionService.getLocalizedActions(); dispatch(setActions(actions)); } catch (e) { console.error('Failed to load quick actions:', e); }
      setIsInitialized(true);
    };
    init();

    const unsubscribeOpenClawStatus = coworkService.onOpenClawEngineStatus(setOpenClawStatus);
    const unsubscribe = quickActionService.subscribe(async () => {
      try { const actions = await quickActionService.getLocalizedActions(); dispatch(setActions(actions)); } catch (e) { console.error('Failed to reload quick actions:', e); }
    });
    return () => { unsubscribe(); unsubscribeOpenClawStatus(); };
  }, [dispatch]);

  const isOpenClawReadyForSession = (status: OpenClawEngineStatus | null): boolean => {
    if (!status) return false;
    return status.phase === 'running' || status.phase === 'ready';
  };

  const isEngineReady = isOpenClawReadyForSession(openClawStatus);

  const handleRestartGateway = async () => {
    if (isRestartingGateway) return;
    setIsRestartingGateway(true);
    try { await coworkService.restartOpenClawGateway(); } catch (e) { console.error('[CoworkView] Failed to restart gateway:', e); } finally { setIsRestartingGateway(false); }
  };

  const resolveEngineStatusText = (status: OpenClawEngineStatus): string => {
    switch (status.phase) {
      case 'not_installed': return i18nService.t('coworkOpenClawNotInstalledNotice');
      case 'installing': return i18nService.t('coworkOpenClawInstalling');
      case 'ready': return i18nService.t('coworkOpenClawReadyNotice');
      case 'starting': case 'compiling': return status.message || i18nService.t('coworkOpenClawStarting');
      case 'error': return i18nService.t('coworkOpenClawError');
      default: return i18nService.t('coworkOpenClawRunning');
    }
  };

  return { isInitialized, openClawStatus, isEngineReady, isRestartingGateway, handleRestartGateway, resolveEngineStatusText, isOpenClawReadyForSession };
}
