import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isProviderEnabled, ProviderName, ProviderRegistry } from '../../../../shared/providers';
import { type AppConfig, getVisibleProviders, isCustomProvider } from '../../../config';
import { LLAMACPP_RUNNING_MODELS_CHANGED_EVENT } from '../../../services/availableModels';
import { configService } from '../../../services/config';
import { i18nService, type LanguageType } from '../../../services/i18n';
import { shouldAutoDetectProviderModels } from '../providerModelAutoDetection';
import {
  CUSTOM_PROVIDER_KEYS,
  LOCAL_MODEL_REFRESH_MIN_LOADING_DURATION_MS,
  providerKeys,
  type ProviderConfig,
  type ProvidersConfig,
  type ProviderType,
} from './constants';
import {
  getDefaultActiveProvider,
  getDefaultProviders,
  getEffectiveApiFormat,
  getProviderDefaultBaseUrl,
  hasProviderAuthConfigured,
  normalizeProviderModelsForSettings,
  providerRequiresApiKey,
  shouldAutoSwitchProviderBaseUrl,
  shouldShowProviderModels,
} from './providerUtils';

interface UseProvidersControllerParams {
  initialProvider?: ProviderType;
  language: LanguageType;
  setError: (message: string | null) => void;
  invalidateProviderModelConnectionStatuses: (provider: ProviderType) => void;
  /** Filled by ModelSettingsPanel once the OAuth hook exists (toggle redirects to sign-in). */
  requestCopilotSignInRef: React.MutableRefObject<() => void>;
}

export function useProvidersController({
  initialProvider,
  language,
  setError,
  invalidateProviderModelConnectionStatuses,
  requestCopilotSignInRef,
}: UseProvidersControllerParams) {
  const [providers, setProviders] = useState<ProvidersConfig>(() => getDefaultProviders());
  const [activeProvider, setActiveProvider] = useState<ProviderType>(
    initialProvider ?? getDefaultActiveProvider(),
  );
  const [isInitialProviderPending, setIsInitialProviderPending] = useState(
    Boolean(initialProvider),
  );
  const [selectedModelId, setSelectedModelId] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [autoDetectRequest, setAutoDetectRequest] = useState<{
    provider: ProviderType;
    requestId: number;
  } | null>(null);
  const [isRefreshingLlamaCppModels, setIsRefreshingLlamaCppModels] = useState(false);
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<ProviderType | null>(null);
  const [pendingApiKeyClearProvider, setPendingApiKeyClearProvider] = useState<ProviderType | null>(
    null,
  );
  const autoDetectRequestIdRef = useRef(0);
  const apiKeyInputDirtyRef = useRef<Partial<Record<ProviderType, boolean>>>({});
  const baseUrlInputDirtyRef = useRef<Partial<Record<ProviderType, boolean>>>({});

  useEffect(() => {
    setShowApiKey(false);
  }, [activeProvider]);

  useEffect(() => {
    const models = providers[activeProvider]?.models ?? [];
    setSelectedModelId(current =>
      models.some(model => model.id === current) ? current : (models[0]?.id ?? ''),
    );
  }, [activeProvider, providers]);

  const syncLlamaCppProviderFromConfig = useCallback(async () => {
    const config = await configService.reload();
    const llamaCppProvider = config.providers?.[ProviderName.LlamaCpp];
    if (!llamaCppProvider) {
      return;
    }

    setProviders(prev => ({
      ...prev,
      [ProviderName.LlamaCpp]: {
        ...prev[ProviderName.LlamaCpp],
        ...llamaCppProvider,
        enabled: prev[ProviderName.LlamaCpp].enabled,
        userEnabled: prev[ProviderName.LlamaCpp].userEnabled,
        apiFormat: getEffectiveApiFormat(ProviderName.LlamaCpp, llamaCppProvider.apiFormat),
        models: normalizeProviderModelsForSettings(ProviderName.LlamaCpp, llamaCppProvider.models),
      },
    }));
  }, []);

  const handleRefreshLlamaCppModels = async (): Promise<void> => {
    if (isRefreshingLlamaCppModels) return;

    const loadingStartedAt = performance.now();
    setIsRefreshingLlamaCppModels(true);
    try {
      await window.electron.llamacpp.refreshRunningModelBindings();
      await syncLlamaCppProviderFromConfig();
    } catch (error) {
      console.error('[Settings] failed to refresh local model bindings:', error);
    } finally {
      const remainingLoadingDuration = Math.max(
        0,
        LOCAL_MODEL_REFRESH_MIN_LOADING_DURATION_MS - (performance.now() - loadingStartedAt),
      );
      if (remainingLoadingDuration > 0) {
        await new Promise<void>(resolve => {
          window.setTimeout(resolve, remainingLoadingDuration);
        });
      }
      setIsRefreshingLlamaCppModels(false);
    }
  };

  useEffect(() => {
    const handleLlamaCppRunningModelsChanged = () => {
      void syncLlamaCppProviderFromConfig().catch(() => undefined);
    };

    window.addEventListener(
      LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
      handleLlamaCppRunningModelsChanged,
    );
    return () => {
      window.removeEventListener(
        LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
        handleLlamaCppRunningModelsChanged,
      );
    };
  }, [syncLlamaCppProviderFromConfig]);

  // Load provider-specific configurations on mount.
  // 合并已保存的配置和默认配置，确保新添加的 provider 能被显示
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const config = await configService.reload();
        if (!active) return;

        // Set up providers based on saved config
        if (!initialProvider && config.api) {
          // For backward compatibility with older config
          // Initialize active provider based on baseUrl
          const normalizedApiBaseUrl = config.api.baseUrl.toLowerCase();
          if (normalizedApiBaseUrl.includes('openai')) {
            setActiveProvider('openai');
            setProviders(prev => ({
              ...prev,
              openai: {
                ...prev.openai,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('deepseek')) {
            setActiveProvider('deepseek');
            setProviders(prev => ({
              ...prev,
              deepseek: {
                ...prev.deepseek,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (
            normalizedApiBaseUrl.includes('moonshot.ai') ||
            normalizedApiBaseUrl.includes('moonshot.cn')
          ) {
            setActiveProvider('moonshot');
            setProviders(prev => ({
              ...prev,
              moonshot: {
                ...prev.moonshot,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('bigmodel.cn')) {
            setActiveProvider('zhipu');
            setProviders(prev => ({
              ...prev,
              zhipu: {
                ...prev.zhipu,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('minimax')) {
            setActiveProvider('minimax');
            setProviders(prev => ({
              ...prev,
              minimax: {
                ...prev.minimax,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('dashscope')) {
            setActiveProvider('qwen');
            setProviders(prev => ({
              ...prev,
              qwen: {
                ...prev.qwen,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('stepfun')) {
            setActiveProvider('stepfun');
            setProviders(prev => ({
              ...prev,
              stepfun: {
                ...prev.stepfun,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('openrouter.ai')) {
            setActiveProvider('openrouter');
            setProviders(prev => ({
              ...prev,
              openrouter: {
                ...prev.openrouter,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('googleapis')) {
            setActiveProvider('gemini');
            setProviders(prev => ({
              ...prev,
              gemini: {
                ...prev.gemini,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('anthropic')) {
            setActiveProvider('anthropic');
            setProviders(prev => ({
              ...prev,
              anthropic: {
                ...prev.anthropic,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (
            normalizedApiBaseUrl.includes('ollama') ||
            normalizedApiBaseUrl.includes('11434')
          ) {
            setActiveProvider('ollama');
            setProviders(prev => ({
              ...prev,
              ollama: {
                ...prev.ollama,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          }
        }

        if (config.providers) {
          setProviders(prev => {
            const merged = {
              ...prev, // 保留默认的 providers（包括新添加的 anthropic）
              ...config.providers, // 覆盖已保存的配置
            };

            // After merging, find the first enabled provider to set as activeProvider
            // This ensures we don't use stale activeProvider from old config.api.baseUrl
            const firstEnabledProvider = providerKeys.find(providerKey =>
              isProviderEnabled(providerKey, merged[providerKey]),
            );
            if (!initialProvider && firstEnabledProvider) {
              setActiveProvider(firstEnabledProvider);
            }

            return Object.fromEntries(
              Object.entries(merged).map(([providerKey, providerConfig]) => {
                const models = shouldShowProviderModels(providerKey, providerConfig)
                  ? normalizeProviderModelsForSettings(providerKey, providerConfig.models)
                  : [];
                return [
                  providerKey,
                  {
                    ...providerConfig,
                    enabled: isProviderEnabled(providerKey, providerConfig),
                    userEnabled:
                      providerKey === ProviderName.LlamaCpp
                        ? providerConfig.userEnabled === true
                        : providerConfig.userEnabled,
                    apiFormat: getEffectiveApiFormat(
                      providerKey,
                      (providerConfig as ProviderConfig).apiFormat,
                    ),
                    models,
                  },
                ];
              }),
            ) as ProvidersConfig;
          });
        }
      } catch {
        if (active) {
          setError(i18nService.t('settingsLoadFailed'));
        }
      } finally {
        if (active) {
          setIsInitialProviderPending(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [initialProvider, setError]);

  // Compute visible providers based on language, including active custom_N entries
  const visibleProviders = useMemo(() => {
    const visibleKeys = getVisibleProviders(language);
    const filtered: Partial<ProvidersConfig> = {};
    for (const key of visibleKeys) {
      if (providers[key as keyof ProvidersConfig]) {
        filtered[key as keyof ProvidersConfig] = providers[key as keyof ProvidersConfig];
      }
    }
    // Append custom_N providers that exist in state, sorted by numeric suffix
    for (const key of CUSTOM_PROVIDER_KEYS) {
      if (providers[key]) {
        filtered[key] = providers[key];
      }
    }
    // Keep the selected provider available while switching locales. Provider visibility
    // is region-based, so otherwise switching languages could unexpectedly change tabs.
    if (providers[activeProvider] && !filtered[activeProvider]) {
      const activeConfig = providers[activeProvider];
      // Keep a provider across locale changes only when the user has actually
      // enabled or configured it. Disabled preset providers must not appear
      // as a lone entry in the provider list.
      if (
        initialProvider === activeProvider ||
        isProviderEnabled(activeProvider, activeConfig) ||
        hasProviderAuthConfigured(activeProvider, activeConfig)
      ) {
        filtered[activeProvider] = activeConfig;
      }
    }
    return filtered as ProvidersConfig;
  }, [activeProvider, initialProvider, language, providers]);

  // Ensure activeProvider is always in visibleProviders when language changes
  useEffect(() => {
    if (isInitialProviderPending) return;
    const visibleKeys = Object.keys(visibleProviders) as ProviderType[];
    if (visibleKeys.length > 0 && !visibleKeys.includes(activeProvider)) {
      // If current activeProvider is not visible, switch to first visible provider
      const firstEnabledVisible = visibleKeys.find(key =>
        isProviderEnabled(key, visibleProviders[key]),
      );
      setActiveProvider(firstEnabledVisible ?? visibleKeys[0]);
    }
  }, [activeProvider, isInitialProviderPending, visibleProviders]);

  // Handle adding a new custom provider
  const handleAddCustomProvider = () => {
    // Find the first unused custom slot
    const usedKeys = new Set(Object.keys(providers));
    const newKey = CUSTOM_PROVIDER_KEYS.find(k => !usedKeys.has(k));
    if (!newKey) return; // All 10 slots used
    setProviders(prev => ({
      ...prev,
      [newKey]: {
        enabled: false,
        apiKey: '',
        baseUrl: '',
        apiFormat: 'openai' as const,
        models: [],
        displayName: undefined,
      },
    }));
    setActiveProvider(newKey);
    setShowApiKey(false);
  };

  // Handle deleting a custom provider
  const handleDeleteCustomProvider = (key: ProviderType) => {
    setPendingDeleteProvider(key);
  };

  const confirmDeleteCustomProvider = () => {
    const key = pendingDeleteProvider;
    if (!key) return;
    invalidateProviderModelConnectionStatuses(key);
    setPendingDeleteProvider(null);
    setProviders(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    // Persist the deletion immediately so it survives window close
    const currentConfig = configService.getConfig();
    const updatedProviders = { ...currentConfig.providers };
    delete updatedProviders[key];
    configService.updateConfig({ providers: updatedProviders as AppConfig['providers'] });
    // If the deleted provider was active, switch to first visible
    if (activeProvider === key) {
      const visibleKeys = Object.keys(visibleProviders).filter(k => k !== key) as ProviderType[];
      const firstEnabled = visibleKeys.find(k => isProviderEnabled(k, visibleProviders[k]));
      setActiveProvider(firstEnabled ?? visibleKeys[0] ?? providerKeys[0]);
    }
  };

  // Handle provider change
  const handleProviderChange = (provider: ProviderType) => {
    setActiveProvider(provider);
    setSelectedModelId('');
  };

  // Handle provider configuration change
  const handleProviderConfigChange = (provider: ProviderType, field: string, value: string) => {
    if (
      field === 'apiKey' ||
      field === 'baseUrl' ||
      field === 'apiFormat' ||
      field === 'codingPlanEnabled' ||
      field === 'authType' ||
      field === 'oauthAccessToken'
    ) {
      invalidateProviderModelConnectionStatuses(provider);
    }
    if (field === 'apiFormat') {
      const currentProviderConfig = providers[provider];
      const nextApiFormat = getEffectiveApiFormat(provider, value);
      const nextBaseUrl = shouldAutoSwitchProviderBaseUrl(provider, currentProviderConfig.baseUrl)
        ? getProviderDefaultBaseUrl(provider, nextApiFormat) || currentProviderConfig.baseUrl
        : currentProviderConfig.baseUrl;
      if (
        shouldAutoDetectProviderModels({
          providerId: provider,
          baseUrl: nextBaseUrl,
          apiKey: currentProviderConfig.apiKey,
          authType: currentProviderConfig.authType,
          requiresApiKey: providerRequiresApiKey(provider),
        })
      ) {
        setAutoDetectRequest({
          provider,
          requestId: ++autoDetectRequestIdRef.current,
        });
      }
    }
    setProviders(prev => {
      if (field === 'apiFormat') {
        const nextApiFormat = getEffectiveApiFormat(provider, value);
        const nextProviderConfig: ProviderConfig = {
          ...prev[provider],
          apiFormat: nextApiFormat,
        };

        // Only auto-switch URL when current value is still a known default URL.
        if (shouldAutoSwitchProviderBaseUrl(provider, prev[provider].baseUrl)) {
          const defaultBaseUrl = getProviderDefaultBaseUrl(provider, nextApiFormat);
          if (defaultBaseUrl) {
            nextProviderConfig.baseUrl = defaultBaseUrl;
          }
        }

        return {
          ...prev,
          [provider]: nextProviderConfig,
        };
      }

      // Handle codingPlanEnabled toggle for all supported providers
      if (field === 'codingPlanEnabled') {
        const def = ProviderRegistry.get(provider);
        if (def?.codingPlanSupported) {
          const enabled = value === 'true';
          const nextModels =
            enabled && def.codingPlanModels
              ? def.codingPlanModels.map(m => ({ ...m }))
              : def.defaultModels.map(m => ({ ...m }));
          return {
            ...prev,
            [provider]: {
              ...prev[provider],
              codingPlanEnabled: enabled,
              models: nextModels,
            },
          };
        }
      }

      return {
        ...prev,
        [provider]: {
          ...prev[provider],
          [field]: value,
        },
      };
    });
  };

  const handleApiKeyInputChange = (provider: ProviderType, value: string) => {
    apiKeyInputDirtyRef.current[provider] = true;
    handleProviderConfigChange(provider, 'apiKey', value);
  };

  const handleBaseUrlInputChange = (provider: ProviderType, value: string) => {
    baseUrlInputDirtyRef.current[provider] = true;
    handleProviderConfigChange(provider, 'baseUrl', value);
  };

  const requestApiKeyClear = (provider: ProviderType) => {
    if (!providers[provider].apiKey) return;
    setPendingApiKeyClearProvider(provider);
  };

  const confirmApiKeyClear = () => {
    const provider = pendingApiKeyClearProvider;
    if (!provider) return;
    setPendingApiKeyClearProvider(null);
    handleApiKeyInputChange(provider, '');
  };

  const handleApiKeyBlur = (provider: ProviderType) => {
    const providerConfig = providers[provider];
    const wasEdited = apiKeyInputDirtyRef.current[provider] === true;
    apiKeyInputDirtyRef.current[provider] = false;
    if (
      !wasEdited ||
      !providerRequiresApiKey(provider) ||
      providerConfig.authType === 'oauth' ||
      !providerConfig.apiKey.trim() ||
      !providerConfig.baseUrl.trim()
    ) {
      return;
    }
    setAutoDetectRequest({
      provider,
      requestId: ++autoDetectRequestIdRef.current,
    });
  };

  const handleBaseUrlBlur = (provider: ProviderType) => {
    const wasEdited = baseUrlInputDirtyRef.current[provider] === true;
    baseUrlInputDirtyRef.current[provider] = false;
    if (!wasEdited || provider !== ProviderName.Ollama || !providers[provider].baseUrl.trim()) {
      return;
    }
    setAutoDetectRequest({
      provider,
      requestId: ++autoDetectRequestIdRef.current,
    });
  };

  // Toggle provider enabled status
  const toggleProviderEnabled = (provider: ProviderType) => {
    const providerConfig = providers[provider];
    const currentEnabled = isProviderEnabled(provider, providerConfig);
    const isEnabling = !currentEnabled;
    const hasValidAuth = hasProviderAuthConfigured(provider, providerConfig);

    // GitHub Copilot requires device code auth — redirect to sign-in flow
    if (provider === 'github-copilot' && isEnabling && !providerConfig.apiKey.trim()) {
      requestCopilotSignInRef.current();
      return;
    }

    if (isEnabling && !hasValidAuth) {
      setError(
        isCustomProvider(provider)
          ? i18nService.t('customProviderBaseUrlRequired')
          : i18nService.t('apiKeyRequired'),
      );
      return;
    }

    invalidateProviderModelConnectionStatuses(provider);
    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        enabled: !currentEnabled,
        userEnabled:
          provider === ProviderName.LlamaCpp ? !currentEnabled : prev[provider].userEnabled,
      },
    }));
  };

  const enableProvider = (provider: ProviderType) => {
    setProviders(prev => {
      if (isProviderEnabled(provider, prev[provider])) {
        return prev;
      }

      return {
        ...prev,
        [provider]: {
          ...prev[provider],
          enabled: true,
          userEnabled: provider === ProviderName.LlamaCpp ? true : prev[provider].userEnabled,
        },
      };
    });
  };

  return {
    providers,
    setProviders,
    activeProvider,
    setActiveProvider,
    isInitialProviderPending,
    selectedModelId,
    setSelectedModelId,
    showApiKey,
    setShowApiKey,
    autoDetectRequest,
    isRefreshingLlamaCppModels,
    handleRefreshLlamaCppModels,
    visibleProviders,
    pendingDeleteProvider,
    setPendingDeleteProvider,
    handleAddCustomProvider,
    handleDeleteCustomProvider,
    confirmDeleteCustomProvider,
    pendingApiKeyClearProvider,
    setPendingApiKeyClearProvider,
    handleProviderChange,
    handleProviderConfigChange,
    handleApiKeyInputChange,
    handleBaseUrlInputChange,
    requestApiKeyClear,
    confirmApiKeyClear,
    handleApiKeyBlur,
    handleBaseUrlBlur,
    toggleProviderEnabled,
    enableProvider,
  };
}
