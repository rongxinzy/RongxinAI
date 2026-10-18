import { useCallback, useMemo, useState } from 'react';

import type {
  LlamaCppModel,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../../../shared/llamacpp';
import { LlamaCppGatewayAccessMode } from '../../../../shared/llamacpp';
import { notifyLlamaCppRunningModelsChanged } from '../../../services/availableModels';
import { i18nService } from '../../../services/i18n';
import {
  LocalInferenceToastKind,
  type LocalInferenceToastKind as LocalInferenceToastKindType,
} from '../types';

const LLAMACPP_LOCALHOST_HOST = '127.0.0.1';
const LLAMACPP_LAN_HOST = '0.0.0.0';
const LLAMACPP_DEFAULT_PORT = '8080';

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
    gatewayAccessMode: allowLanAccess
      ? LlamaCppGatewayAccessMode.Lan
      : LlamaCppGatewayAccessMode.Local,
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
  serviceConfig: LlamaCppServiceConfig;
  accessSettingsOpen: boolean;
  draftAllowLanAccess: boolean;
  draftKeepRunningOnAppQuit: boolean;
  draftPort: string;
  draftLanToken: string;
  setDraftKeepRunningOnAppQuit: (value: boolean) => void;
  setDraftPort: (value: string) => void;
  currentHost: string;
  currentPort: string;
  /** Gateway port serving LAN requests; undefined while the model gateway is not running. */
  lanGatewayPort: string | undefined;
  exampleModelName?: string;
  refreshServiceConfig: () => Promise<LlamaCppServiceConfig>;
  openAccessSettings: () => void;
  closeAccessSettings: () => void;
  saveAccessSettings: () => void;
  setDraftAllowLanAccess: (value: boolean) => void;
  regenerateLanToken: () => void;
};

/** Extracts the LAN port from the bundled model gateway's URL. */
function parseLanGatewayPort(gatewayUrl: string | undefined): string | undefined {
  if (!gatewayUrl) return undefined;
  try {
    return new URL(gatewayUrl).port || undefined;
  } catch {
    return undefined;
  }
}

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
  const [draftLanToken, setDraftLanToken] = useState('');
  const [lanGatewayPort, setLanGatewayPort] = useState<string | undefined>(undefined);

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

  const refreshLanGatewayPort = useCallback(async () => {
    // LAN requests are served by the bundled model gateway, so the advertised
    // endpoint must use its port (not the llama.cpp service port).
    try {
      const status = await window.electron.magpie.status();
      setLanGatewayPort(
        status.state === 'running' ? parseLanGatewayPort(status.gatewayUrl) : undefined,
      );
    } catch {
      setLanGatewayPort(undefined);
    }
  }, []);

  const openAccessSettings = useCallback(() => {
    void refreshServiceConfig()
      .then(nextConfig => {
        const nextHost =
          nextConfig.listenHost?.trim() || nextConfig.host?.trim() || LLAMACPP_LOCALHOST_HOST;
        setDraftAllowLanAccess(nextHost === LLAMACPP_LAN_HOST);
        setDraftKeepRunningOnAppQuit(nextConfig.keepRunningOnAppQuit !== false);
        setDraftPort(nextConfig.port?.trim() || LLAMACPP_DEFAULT_PORT);
        if (nextHost === LLAMACPP_LAN_HOST) {
          void refreshLanGatewayPort();
          void window.electron.llamacpp
            .getGatewayLanToken()
            .then(token => setDraftLanToken(token.token))
            .catch(() => setDraftLanToken(''));
        } else {
          setDraftLanToken('');
        }
        setAccessSettingsOpen(true);
      })
      .catch(() => {
        setDraftAllowLanAccess(allowLanAccess);
        setDraftKeepRunningOnAppQuit(true);
        setDraftPort(currentPort);
        setDraftLanToken('');
        setAccessSettingsOpen(true);
      });
  }, [allowLanAccess, currentPort, refreshLanGatewayPort, refreshServiceConfig]);

  const closeAccessSettings = useCallback(() => {
    setAccessSettingsOpen(false);
  }, []);

  const updateDraftAllowLanAccess = useCallback(
    (value: boolean) => {
      setDraftAllowLanAccess(value);
      if (!value) {
        setDraftLanToken('');
        return;
      }
      void refreshLanGatewayPort();
      void window.electron.llamacpp
        .getGatewayLanToken()
        .then(result => setDraftLanToken(result.token))
        .catch(() => setDraftLanToken(''));
    },
    [refreshLanGatewayPort],
  );

  const regenerateLanToken = useCallback(() => {
    void runAction(async () => {
      const result = await window.electron.llamacpp.regenerateGatewayLanToken();
      setDraftLanToken(result.token);
    });
  }, [runAction]);

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
        await refreshLanGatewayPort();
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
    refreshLanGatewayPort,
    refreshLocalModels,
    runAction,
    onRestartStatus,
    showToast,
  ]);

  return {
    serviceConfig,
    accessSettingsOpen,
    draftAllowLanAccess,
    draftKeepRunningOnAppQuit,
    draftPort,
    draftLanToken,
    setDraftKeepRunningOnAppQuit,
    setDraftPort,
    currentHost,
    currentPort,
    lanGatewayPort,
    exampleModelName,
    refreshServiceConfig,
    openAccessSettings,
    closeAccessSettings,
    saveAccessSettings,
    setDraftAllowLanAccess: updateDraftAllowLanAccess,
    regenerateLanToken,
  };
}
