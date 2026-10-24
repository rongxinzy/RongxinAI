import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import {
  ManagedProviderAccessMode,
  type ManagedProviderAccessPolicy,
} from '../../shared/managedProviders';
import { ZhiyuanModelPoolEvent } from '../../shared/modelPool/constants';
import {
  refreshMagpieModels,
  LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
  notifyLlamaCppRunningModelsChanged,
} from '../services/availableModels';
import { configService } from '../services/config';
import { MainView } from './constants';

/** Existing shell model refresh lifecycle, independent of the active feature view. */
export function useAvailableModelsRefresh(
  initialized: boolean,
  setPolicy: Dispatch<SetStateAction<ManagedProviderAccessPolicy | null>>,
  setMainView: Dispatch<SetStateAction<MainView>>,
) {
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const requestId = ++latest.current;
    try {
      const [, policy] = await Promise.all([
        refreshMagpieModels(),
        window.electron.managedProviders.policy(),
      ]);
      if (requestId !== latest.current) return;
      setPolicy(policy);
      if (policy.mode === ManagedProviderAccessMode.Exclusive)
        setMainView(current => (current === MainView.LocalInference ? MainView.Cowork : current));
    } catch (error) {
      console.error('[App] failed to refresh available models:', error);
    }
  }, [setPolicy, setMainView]);
  useEffect(() => {
    if (!initialized) return;
    const refreshChanged = () => {
      void refresh();
    };
    const bindingsChanged = () => {
      void configService
        .reload()
        .then(() => notifyLlamaCppRunningModelsChanged())
        .catch(error => {
          console.error('[App] failed to reload config after model bindings changed:', error);
        });
    };
    window.addEventListener('config-updated', refreshChanged);
    window.addEventListener(LLAMACPP_RUNNING_MODELS_CHANGED_EVENT, refreshChanged);
    window.addEventListener(ZhiyuanModelPoolEvent.AuthChanged, refreshChanged);
    const unsubscribeBindings = window.electron.llamacpp.onModelBindingsChanged(bindingsChanged);
    const unsubscribePolicy = window.electron.managedProviders.onChanged(refreshChanged);
    return () => {
      window.removeEventListener('config-updated', refreshChanged);
      window.removeEventListener(LLAMACPP_RUNNING_MODELS_CHANGED_EVENT, refreshChanged);
      window.removeEventListener(ZhiyuanModelPoolEvent.AuthChanged, refreshChanged);
      unsubscribeBindings();
      unsubscribePolicy();
    };
  }, [initialized, refresh]);
  return refresh;
}
