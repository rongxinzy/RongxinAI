import { useCallback, useMemo, useState } from 'react';

import type {
  LlamaCppModel,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../../../shared/llamacpp';
import { notifyLlamaCppRunningModelsChanged } from '../../../services/availableModels';
import { i18nService } from '../../../services/i18n';
import {
  LocalInferenceToastKind,
  type LocalInferenceToastKind as LocalInferenceToastKindType,
} from '../types';

export const LLAMACPP_LOCALHOST_HOST = '127.0.0.1';
export const LLAMACPP_LAN_HOST = '0.0.0.0';
export const LLAMACPP_DEFAULT_PORT = '8080';

type UseLocalInferenceAccessSettingsInput = {
  isRunning: boolean;
  localModels: LlamaCppModel[];
  runningModels: LlamaCppRunningModel[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  refreshLocalModels: () => Promise<LlamaCppModel[]>;
  refreshRunningModels: () => Promise<LlamaCppRunningModel[]>;
  onRestartStatus: (status: LlamaCppStatusSnapshot) => void;
  showToast: (
    message: string,
    kind?: LocalInferenceToastKindType,
    autoDismiss?: boolean,
  ) => void;
};

type UseLocalInferenceAccessSettingsResult = {
  accessSettingsOpen: boolean;
  draftAllowLanAccess: boolean;
  currentHost: string;
  currentPort: string;
  exampleModelName?: string;
  refreshServiceConfig: () => Promise<LlamaCppServiceConfig>;
  openAccessSettings: () => void;
  closeAccessSettings: () => void;
  saveAccessSettings: () => void;
  setDraftAllowLanAccess: (value: boolean) => void;
};

export function useLocalInferenceAccessSettings(
  input: UseLocalInferenceAccessSettingsInput,
): UseLocalInferenceAccessSettingsResult {
  const {
    isRunning,
    localModels,
    runningModels,
    runAction,
    refreshLocalModels,
    refreshRunningModels,
    onRestartStatus,
    showToast,
  } = input;
  const [serviceConfig, setServiceConfig] = useState<LlamaCppServiceConfig>({});
  const [accessSettingsOpen, setAccessSettingsOpen] = useState(false);
  const [draftAllowLanAccess, setDraftAllowLanAccess] = useState(false);

  const currentHost =
    serviceConfig.listenHost?.trim() ||
    serviceConfig.host?.trim() ||
    LLAMACPP_LOCALHOST_HOST;
  const currentPort = serviceConfig.port?.trim() || LLAMACPP_DEFAULT_PORT;
  const allowLanAccess = currentHost === LLAMACPP_LAN_HOST;
  const exampleModelName = useMemo(
    () =>
      (runningModels[0]?.name || runningModels[0]?.model || localModels[0]?.name || '').trim() || undefined,
    [localModels, runningModels],
  );

  const refreshServiceConfig = useCallback(async () => {
    const nextConfig = await window.electron.llamacpp.getServiceConfig();
    setServiceConfig(nextConfig);
    return nextConfig;
  }, []);

  const openAccessSettings = useCallback(() => {
    setDraftAllowLanAccess(allowLanAccess);
    setAccessSettingsOpen(true);
  }, [allowLanAccess]);

  const closeAccessSettings = useCallback(() => {
    setAccessSettingsOpen(false);
  }, []);

  const saveAccessSettings = useCallback(() => {
    void runAction(async () => {
      const previousConfig = serviceConfig;
      const nextConfig = await window.electron.llamacpp.setServiceConfig({
        ...serviceConfig,
        listenHost: draftAllowLanAccess ? LLAMACPP_LAN_HOST : LLAMACPP_LOCALHOST_HOST,
      });

      try {
        setServiceConfig(nextConfig);
        if (isRunning) {
          const nextStatus = await window.electron.llamacpp.restart();
          onRestartStatus(nextStatus);
          if (nextStatus.status !== 'running') {
            throw new Error(nextStatus.error || i18nService.t('localInferenceLaunchRestartFailed'));
          }
          await refreshLocalModels().catch(() => undefined);
          await refreshRunningModels().catch(() => undefined);
          notifyLlamaCppRunningModelsChanged();
        }
        setDraftAllowLanAccess(
          (
            nextConfig.listenHost?.trim() ||
            nextConfig.host?.trim() ||
            LLAMACPP_LOCALHOST_HOST
          ) === LLAMACPP_LAN_HOST,
        );
        setAccessSettingsOpen(false);
        showToast(
          isRunning
            ? i18nService.t('localInferenceAccessSettingsSavedRestarted')
            : i18nService.t('localInferenceAccessSettingsSaved'),
          LocalInferenceToastKind.Success,
        );
      } catch (error) {
        await window.electron.llamacpp.setServiceConfig(previousConfig).catch(() => undefined);
        setServiceConfig(previousConfig);
        throw error;
      }
    });
  }, [
    draftAllowLanAccess,
    isRunning,
    refreshLocalModels,
    refreshRunningModels,
    runAction,
    serviceConfig,
    onRestartStatus,
    showToast,
  ]);

  return {
    accessSettingsOpen,
    draftAllowLanAccess,
    currentHost,
    currentPort,
    exampleModelName,
    refreshServiceConfig,
    openAccessSettings,
    closeAccessSettings,
    saveAccessSettings,
    setDraftAllowLanAccess,
  };
}
