import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useDispatch } from 'react-redux';

import { type ManagedProviderAccessPolicy } from '../../shared/managedProviders';
import type { SettingsEnterpriseConfig } from '../components/settings/types';
import { refreshMagpieModels } from '../services/availableModels';
import { configService } from '../services/config';
import { i18nService } from '../services/i18n';
import { themeService } from '../services/theme';
import { WorkMode } from '../store/workMode/constants';
import { setWorkMode } from '../store/workMode/workModeSlice';
import { waitWithTimeout } from './waitWithTimeout';

/** Used for config + i18n init; longer on Windows where main-process IPC can stall during cold start. */
const INIT_STEP_TIMEOUT_MS_WINDOWS = 24_000;
const INIT_STEP_TIMEOUT_MS_DEFAULT = 16_000;

export interface AppBootstrapState {
  isInitialized: boolean;
  initError: string | null;
  enterpriseConfig: SettingsEnterpriseConfig | null;
  managedProviderPolicy: ManagedProviderAccessPolicy | null;
  setManagedProviderPolicy: Dispatch<SetStateAction<ManagedProviderAccessPolicy | null>>;
}

/**
 * Runs the one-shot app bootstrap sequence (config, theme, enterprise config,
 * i18n, work mode, model catalog) and exposes its resulting shell state.
 */
export function useAppBootstrap(): AppBootstrapState {
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [enterpriseConfig, setEnterpriseConfig] = useState<SettingsEnterpriseConfig | null>(null);
  const [managedProviderPolicy, setManagedProviderPolicy] =
    useState<ManagedProviderAccessPolicy | null>(null);
  const hasInitialized = useRef(false);
  const dispatch = useDispatch();

  // 鍒濆鍖栧簲鐢?
  useEffect(() => {
    if (hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;

    const initializeApp = async () => {
      const t0 = performance.now();
      const mark = (label: string) => {
        const elapsed = Math.round(performance.now() - t0);
        const msg = `initializeApp: ${label} (+${elapsed}ms)`;
        console.info(`[App] ${msg}`);
        try {
          window.electron?.log?.fromRenderer?.('info', 'App', msg);
        } catch {
          /* preload may not expose this yet */
        }
      };

      try {
        mark('start');
        document.documentElement.classList.add(`platform-${window.electron.platform}`);

        const initTimeoutMs =
          window.electron.platform === 'win32'
            ? INIT_STEP_TIMEOUT_MS_WINDOWS
            : INIT_STEP_TIMEOUT_MS_DEFAULT;
        mark('configService.init begin');
        await waitWithTimeout(configService.init(), initTimeoutMs, 'configService.init');
        mark('configService.init done');

        const config = configService.getConfig();
        themeService.initialize();
        mark('themeService done');

        // Enterprise and i18n only depend on config initialization.
        mark('enterprise/i18n init begin');
        const [entConfig, , providerPolicy] = await Promise.all([
          window.electron.enterprise.getConfig(),
          waitWithTimeout(i18nService.initialize(), initTimeoutMs, 'i18nService.initialize'),
          window.electron.managedProviders.policy(),
        ]);
        setEnterpriseConfig(entConfig);
        setManagedProviderPolicy(providerPolicy);
        mark('enterprise/i18n init done');

        dispatch(setWorkMode(config.workMode ?? WorkMode.Work));

        // Catalog access never starts Magpie; unavailable models do not block the shell.
        await waitWithTimeout(refreshMagpieModels(), initTimeoutMs, 'magpie.catalog').catch(
          error => {
            console.error('[App] model catalog unavailable:', error);
          },
        );
        mark('model resolution done');

        setIsInitialized(true);
        mark('shell ready');
      } catch (error) {
        const elapsed = Math.round(performance.now() - t0);
        const msg = error instanceof Error ? error.message : String(error);
        const detail = `initializeApp FAILED after ${elapsed}ms: ${msg}`;
        console.error(`[App] ${detail}`);
        try {
          window.electron?.log?.fromRenderer?.('error', 'App', detail);
        } catch {
          /* best-effort */
        }
        setInitError(i18nService.t('initializationError'));
        setIsInitialized(true);
      }
    };

    void initializeApp();
  }, [dispatch]);

  return {
    isInitialized,
    initError,
    enterpriseConfig,
    managedProviderPolicy,
    setManagedProviderPolicy,
  };
}
