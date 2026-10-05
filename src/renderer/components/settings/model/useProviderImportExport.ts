import { useRef, useState } from 'react';

import { ProviderName } from '../../../../shared/providers';
import { APP_ID, EXPORT_FORMAT_TYPE, EXPORT_PASSWORD } from '../../../constants/app';
import { isCustomProvider } from '../../../config';
import {
  decryptSecret,
  decryptWithPassword,
  type EncryptedPayload,
  encryptWithPassword,
  type PasswordEncryptedPayload,
} from '../../../services/encryption';
import { i18nService } from '../../../services/i18n';
import { providerKeys, type Model, type ProvidersConfig, type ProviderType } from './constants';
import { getEffectiveApiFormat, normalizeModels, resolveBaseUrl } from './providerUtils';

interface ProviderExportEntry {
  enabled: boolean;
  userEnabled?: boolean;
  apiKey: PasswordEncryptedPayload;
  baseUrl: string;
  apiFormat?: 'anthropic' | 'openai' | 'gemini';
  codingPlanEnabled?: boolean;
  models?: Model[];
}

interface ProvidersExportPayload {
  type: typeof EXPORT_FORMAT_TYPE;
  version: 2;
  exportedAt: string;
  encryption: {
    algorithm: 'AES-GCM';
    keySource: 'password';
    keyDerivation: 'PBKDF2';
  };
  providers: Record<string, ProviderExportEntry>;
}

interface ProvidersImportEntry {
  enabled?: boolean;
  userEnabled?: boolean;
  apiKey?: EncryptedPayload | PasswordEncryptedPayload | string;
  apiKeyEncrypted?: string;
  apiKeyIv?: string;
  baseUrl?: string;
  apiFormat?: 'anthropic' | 'openai' | 'native';
  codingPlanEnabled?: boolean;
  models?: Model[];
}

interface ProvidersImportPayload {
  type?: string;
  version?: number;
  encryption?: {
    algorithm?: string;
    keySource?: string;
    keyDerivation?: string;
  };
  providers?: Record<string, ProvidersImportEntry>;
}

const DEFAULT_EXPORT_PASSWORD = EXPORT_PASSWORD;

interface UseProviderImportExportParams {
  providers: ProvidersConfig;
  setProviders: React.Dispatch<React.SetStateAction<ProvidersConfig>>;
  setError: (message: string | null) => void;
  setNoticeMessage: (message: string | null) => void;
}

export function useProviderImportExport({
  providers,
  setProviders,
  setError,
  setNoticeMessage,
}: UseProviderImportExportParams) {
  const [isImportingProviders, setIsImportingProviders] = useState(false);
  const [isExportingProviders, setIsExportingProviders] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const buildProvidersExport = async (password: string): Promise<ProvidersExportPayload> => {
    // Only export providers that have an API key configured, regardless of enabled state.
    // Skip preset providers that were never configured to avoid exporting default models.
    const configuredEntries = Object.entries(providers).filter(([providerKey, cfg]) => {
      const providerConfig = cfg as ProvidersConfig[string];
      return isCustomProvider(providerKey)
        ? Boolean(providerConfig.baseUrl?.trim() || providerConfig.apiKey?.trim())
        : Boolean(providerConfig.apiKey?.trim());
    });
    const entries = await Promise.all(
      configuredEntries.map(async ([providerKey, providerConfig]) => {
        const apiKey = await encryptWithPassword(providerConfig.apiKey, password);
        const apiFormat = getEffectiveApiFormat(providerKey, providerConfig.apiFormat);
        return [
          providerKey,
          {
            enabled: providerConfig.enabled,
            userEnabled: providerConfig.userEnabled,
            apiKey,
            baseUrl: resolveBaseUrl(providerKey as ProviderType, providerConfig.baseUrl, apiFormat),
            apiFormat,
            codingPlanEnabled: providerConfig.codingPlanEnabled,
            models: normalizeModels(providerKey, providerConfig.models),
          },
        ] as const;
      }),
    );

    return {
      type: EXPORT_FORMAT_TYPE,
      version: 2,
      exportedAt: new Date().toISOString(),
      encryption: {
        algorithm: 'AES-GCM',
        keySource: 'password',
        keyDerivation: 'PBKDF2',
      },
      providers: Object.fromEntries(entries),
    };
  };

  const handleExportProviders = async () => {
    setError(null);
    setIsExportingProviders(true);

    try {
      const payload = await buildProvidersExport(DEFAULT_EXPORT_PASSWORD);
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${APP_ID}-providers-${date}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      console.error('Failed to export providers:', err);
      setError(i18nService.t('exportProvidersFailed'));
    } finally {
      setIsExportingProviders(false);
    }
  };

  const handleImportProvidersClick = () => {
    importInputRef.current?.click();
  };

  const handleImportProviders = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setError(null);

    try {
      const raw = await file.text();
      console.log(`[Settings] importing providers from file: ${file.name}, size: ${file.size}`);
      let payload: ProvidersImportPayload;
      try {
        payload = JSON.parse(raw) as ProvidersImportPayload;
      } catch {
        console.warn('[Settings] import failed: invalid JSON in file');
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      if (!payload || payload.type !== EXPORT_FORMAT_TYPE || !payload.providers) {
        console.warn(
          `[Settings] import failed: invalid format, type=${payload?.type}, hasProviders=${!!payload?.providers}`,
        );
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      // Check if it's version 2 (password-based encryption)
      if (payload.version === 2 && payload.encryption?.keySource === 'password') {
        console.log('[Settings] import: detected v2 password-based encryption');
        await processImportPayloadWithPassword(payload);
        return;
      }

      // Version 1 (legacy local-store key) - try to decrypt with local key
      if (payload.version === 1) {
        console.log('[Settings] import: detected v1 local-key encryption');
        await processImportPayloadWithLocalKey(payload);
        return;
      }

      console.warn(`[Settings] import failed: unsupported version=${payload.version}`);
      setError(i18nService.t('invalidProvidersFile'));
    } catch (err) {
      console.error('[Settings] import failed:', err);
      setError(i18nService.t('importProvidersFailed'));
    }
  };

  const processImportPayloadWithLocalKey = async (payload: ProvidersImportPayload) => {
    setIsImportingProviders(true);
    try {
      const fileKeys = Object.keys(payload.providers ?? {});
      console.log(`[Settings] v1 import: processing ${fileKeys.length} providers from file`);
      const providerUpdates: Partial<ProvidersConfig> = {};
      let hadDecryptFailure = false;
      for (const providerKey of providerKeys) {
        const providerData = payload.providers?.[providerKey];
        if (!providerData) {
          continue;
        }

        let apiKey: string | undefined;
        if (typeof providerData.apiKey === 'string') {
          apiKey = providerData.apiKey;
        } else if (providerData.apiKey && typeof providerData.apiKey === 'object') {
          try {
            apiKey = await decryptSecret(providerData.apiKey as EncryptedPayload);
            console.log(`[Settings] v1 import: decrypted key for ${providerKey}`);
          } catch (error) {
            hadDecryptFailure = true;
            console.warn(`[Settings] v1 import: failed to decrypt key for ${providerKey}`, error);
          }
        } else if (
          typeof providerData.apiKeyEncrypted === 'string' &&
          typeof providerData.apiKeyIv === 'string'
        ) {
          try {
            apiKey = await decryptSecret({
              encrypted: providerData.apiKeyEncrypted,
              iv: providerData.apiKeyIv,
            });
            console.log(`[Settings] v1 import: decrypted key for ${providerKey}`);
          } catch (error) {
            hadDecryptFailure = true;
            console.warn(`[Settings] v1 import: failed to decrypt key for ${providerKey}`, error);
          }
        }

        const models = normalizeModels(providerKey, providerData.models);
        const existing = providers[providerKey];

        providerUpdates[providerKey] = {
          enabled:
            typeof providerData.enabled === 'boolean'
              ? providerData.enabled
              : (existing?.enabled ?? false),
          userEnabled:
            typeof providerData.userEnabled === 'boolean'
              ? providerData.userEnabled
              : providerKey === ProviderName.LlamaCpp
                ? typeof providerData.enabled === 'boolean'
                  ? providerData.enabled
                  : (existing?.userEnabled ?? false)
                : existing?.userEnabled,
          apiKey: apiKey ?? existing?.apiKey ?? '',
          baseUrl:
            typeof providerData.baseUrl === 'string'
              ? providerData.baseUrl
              : (existing?.baseUrl ?? ''),
          apiFormat: getEffectiveApiFormat(
            providerKey,
            providerData.apiFormat ?? existing?.apiFormat,
          ),
          codingPlanEnabled:
            typeof providerData.codingPlanEnabled === 'boolean'
              ? providerData.codingPlanEnabled
              : existing?.codingPlanEnabled,
          models: models ?? existing?.models,
        };
      }

      if (Object.keys(providerUpdates).length === 0) {
        console.warn(
          `[Settings] v1 import failed: no matching providers found, file keys: ${fileKeys.join(', ')}`,
        );
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      setProviders(prev => {
        const next = { ...prev };
        Object.entries(providerUpdates).forEach(([providerKey, update]) => {
          next[providerKey] = {
            ...prev[providerKey],
            ...update,
          };
        });
        return next;
      });
      console.log(
        `[Settings] v1 import complete: updated ${Object.keys(providerUpdates).length} providers`,
      );
      if (hadDecryptFailure) {
        setNoticeMessage(i18nService.t('decryptProvidersPartial'));
      }
    } catch (err) {
      console.error('[Settings] v1 import failed:', err);
      const isDecryptError =
        err instanceof Error &&
        (err.message === 'Invalid encrypted payload' || err.name === 'OperationError');
      const message = isDecryptError
        ? i18nService.t('decryptProvidersFailed')
        : i18nService.t('importProvidersFailed');
      setError(message);
    } finally {
      setIsImportingProviders(false);
    }
  };

  const processImportPayloadWithPassword = async (payload: ProvidersImportPayload) => {
    if (!payload.providers) {
      return;
    }

    setIsImportingProviders(true);

    try {
      const fileKeys = Object.keys(payload.providers);
      console.log(`[Settings] v2 import: processing ${fileKeys.length} providers from file`);
      const providerUpdates: Partial<ProvidersConfig> = {};
      let hadDecryptFailure = false;

      for (const providerKey of providerKeys) {
        const providerData = payload.providers[providerKey];
        if (!providerData) {
          continue;
        }

        let apiKey: string | undefined;
        if (typeof providerData.apiKey === 'string') {
          apiKey = providerData.apiKey;
        } else if (providerData.apiKey && typeof providerData.apiKey === 'object') {
          const apiKeyObj = providerData.apiKey as PasswordEncryptedPayload;
          if (apiKeyObj.salt) {
            // Version 2 password-based encryption
            try {
              apiKey = await decryptWithPassword(apiKeyObj, DEFAULT_EXPORT_PASSWORD);
              console.log(`[Settings] v2 import: decrypted key for ${providerKey}`);
            } catch (error) {
              hadDecryptFailure = true;
              console.warn(`[Settings] v2 import: failed to decrypt key for ${providerKey}`, error);
            }
          }
        }

        const models = normalizeModels(providerKey, providerData.models);
        const existing = providers[providerKey];

        providerUpdates[providerKey] = {
          enabled:
            typeof providerData.enabled === 'boolean'
              ? providerData.enabled
              : (existing?.enabled ?? false),
          userEnabled:
            typeof providerData.userEnabled === 'boolean'
              ? providerData.userEnabled
              : providerKey === ProviderName.LlamaCpp
                ? typeof providerData.enabled === 'boolean'
                  ? providerData.enabled
                  : (existing?.userEnabled ?? false)
                : existing?.userEnabled,
          apiKey: apiKey ?? existing?.apiKey ?? '',
          baseUrl:
            typeof providerData.baseUrl === 'string'
              ? providerData.baseUrl
              : (existing?.baseUrl ?? ''),
          apiFormat: getEffectiveApiFormat(
            providerKey,
            providerData.apiFormat ?? existing?.apiFormat,
          ),
          codingPlanEnabled:
            typeof providerData.codingPlanEnabled === 'boolean'
              ? providerData.codingPlanEnabled
              : existing?.codingPlanEnabled,
          models: models ?? existing?.models,
        };
      }

      if (Object.keys(providerUpdates).length === 0) {
        console.warn(
          `[Settings] v2 import failed: no matching providers found, file keys: ${fileKeys.join(', ')}`,
        );
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      // Check if any key was successfully decrypted
      const anyKeyDecrypted = Object.entries(providerUpdates).some(
        ([key, update]) => update?.apiKey && update.apiKey !== providers[key]?.apiKey,
      );

      if (!anyKeyDecrypted && hadDecryptFailure) {
        // All decryptions failed - likely wrong password
        console.warn(
          '[Settings] v2 import failed: all key decryptions failed, likely wrong password',
        );
        setError(i18nService.t('decryptProvidersFailed'));
        return;
      }

      setProviders(prev => {
        const next = { ...prev };
        Object.entries(providerUpdates).forEach(([providerKey, update]) => {
          next[providerKey] = {
            ...prev[providerKey],
            ...update,
          };
        });
        return next;
      });
      console.log(
        `[Settings] v2 import complete: updated ${Object.keys(providerUpdates).length} providers`,
      );
      if (hadDecryptFailure) {
        setNoticeMessage(i18nService.t('decryptProvidersPartial'));
      }
    } catch (err) {
      console.error('[Settings] v2 import failed:', err);
      const isDecryptError =
        err instanceof Error &&
        (err.message === 'Invalid encrypted payload' || err.name === 'OperationError');
      const message = isDecryptError
        ? i18nService.t('decryptProvidersFailed')
        : i18nService.t('importProvidersFailed');
      setError(message);
    } finally {
      setIsImportingProviders(false);
    }
  };

  return {
    importInputRef,
    isImportingProviders,
    isExportingProviders,
    handleExportProviders,
    handleImportProvidersClick,
    handleImportProviders,
  };
}
