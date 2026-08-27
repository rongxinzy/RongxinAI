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

export function isValidLlamaCppPort(value: string): boolean {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return false;

  const port = Number.parseInt(trimmed, 10);
  return port >= 1 && port <= 65_535;
}

export function buildAccessSettingsConfig(
  config: LlamaCppServiceConfig,
  allowLanAccess: boolean,
  port = config.port,
  keepRunningOnAppQuit = config.keepRunningOnAppQuit ?? true,
): LlamaCppServiceConfig {
  return {
    ...config,
    port: port?.trim() || undefined,
    listenHost: allowLanAccess ? LLAMACPP_LAN_HOST : LLAMACPP_LOCALHOST_HOST,
    keepRunningOnAppQuit,
  };
}

type UseLocalInferenceAccessSettingsInput = {
  isRunning: boolean;
  localModels: LlamaCppModel[];
  runningModels: LlamaCppRunningModel[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  refreshLocalModels: () => Promise<LlamaCppModel[]>;
  onRestartStatus: (status: LlamaCppStatusSnapshot) => void;
  showToast: (message: string, kind?: LocalInferenceToastKindType, autoDismiss?: boolean) => void;
};

type UseLocalInferenceAccessSettingsResult = {
  accessSettingsOpen: boolean;
  draftAllowLanAccess: boolean;
  draftKeepRunningOnAppQuit: boolean;
  draftPort: string;
  setDraftKeepRunningOnAppQuit: (value: boolean) => void;
  setDraftPort: (value: string) => void;
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
    onRestartStatus,
    showToast,
  } = input;
  const [serviceConfig, setServiceConfig] = useState<LlamaCppServiceConfig>({});
  const [accessSettingsOpen, setAccessSettingsOpen] = useState(false);
  const [draftAllowLanAccess, setDraftAllowLanAccess] = useState(false);
  const [draftKeepRunningOnAppQuit, setDraftKeepRunningOnAppQuit] = useState(true);
  const [draftPort, setDraftPort] = useState(LLAMACPP_DEFAULT_PORT);

  const currentHost =
    serviceConfig.listenHost?.trim() || serviceConfig.host?.trim() || LLAMACPP_LOCALHOST_HOST;
  const currentPort = serviceConfig.port?.trim() || LLAMACPP_DEFAULT_PORT;
  const allowLanAccess = currentHost === LLAMACPP_LAN_HOST;
  const exampleModelName = useMemo(
    () =>
      (runningModels[0]?.name || runningModels[0]?.model || localModels[0]?.name || '').trim() ||
      undefined,
    [localModels, runningModels],
  );

  const refreshServiceConfig = useCallback(async () => {
    const nextConfig = await window.electron.llamacpp.getServiceConfig();
    setServiceConfig(nextConfig);
    return nextConfig;
  }, []);

  const openAccessSettings = useCallback(() => {
    void refreshServiceConfig()
      .then(nextConfig => {
        const nextHost =
          nextConfig.listenHost?.trim() || nextConfig.host?.trim() || LLAMACPP_LOCALHOST_HOST;
        setDraftAllowLanAccess(nextHost === LLAMACPP_LAN_HOST);
        setDraftKeepRunningOnAppQuit(nextConfig.keepRunningOnAppQuit !== false);
        setDraftPort(nextConfig.port?.trim() || LLAMACPP_DEFAULT_PORT);
        setAccessSettingsOpen(true);
      })
      .catch(() => {
        setDraftAllowLanAccess(allowLanAccess);
        setDraftKeepRunningOnAppQuit(true);
        setDraftPort(currentPort);
        setAccessSettingsOpen(true);
      });
  }, [allowLanAccess, currentPort, refreshServiceConfig]);

  const closeAccessSettings = useCallback(() => {
    setAccessSettingsOpen(false);
  }, []);

  const saveAccessSettings = useCallback(() => {
    void runAction(async () => {
      const previousConfig = await window.electron.llamacpp.getServiceConfig();
      const nextConfig = await window.electron.llamacpp.setServiceConfig(
        buildAccessSettingsConfig(
          previousConfig,
          draftAllowLanAccess,
          draftPort,
          draftKeepRunningOnAppQuit,
        ),
      );

      try {
        setServiceConfig(nextConfig);
        if (isRunning) {
          const nextStatus = await window.electron.llamacpp.restart();
          onRestartStatus(nextStatus);
          if (nextStatus.status !== 'running') {
            throw new Error(nextStatus.error || i18nService.t('localInferenceLaunchRestartFailed'));
          }
          await refreshLocalModels().catch(() => undefined);
          notifyLlamaCppRunningModelsChanged();
        }
        setDraftAllowLanAccess(
          (nextConfig.listenHost?.trim() || nextConfig.host?.trim() || LLAMACPP_LOCALHOST_HOST) ===
            LLAMACPP_LAN_HOST,
        );
        setDraftPort(nextConfig.port?.trim() || LLAMACPP_DEFAULT_PORT);
        setDraftKeepRunningOnAppQuit(nextConfig.keepRunningOnAppQuit !== false);
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
    draftKeepRunningOnAppQuit,
    draftPort,
    isRunning,
    refreshLocalModels,
    runAction,
    onRestartStatus,
    showToast,
  ]);

  return {
    accessSettingsOpen,
    draftAllowLanAccess,
    draftKeepRunningOnAppQuit,
    draftPort,
    setDraftKeepRunningOnAppQuit,
    setDraftPort,
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
