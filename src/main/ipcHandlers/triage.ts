import { ipcMain } from 'electron';

import type { TriageConfig } from '../../shared/triage';
import { DEFAULT_TRIAGE_CONFIG, TriageIpcChannel } from '../../shared/triage';
import type { SqliteStore } from '../sqliteStore';

const TRIAGE_CONFIG_KEY = 'model_triage_config';

export function registerTriageIpcHandlers(options: { getStore: () => SqliteStore }): void {
  ipcMain.handle(TriageIpcChannel.GetConfig, async () => {
    const stored = options.getStore().get<TriageConfig>(TRIAGE_CONFIG_KEY);
    if (stored && typeof stored === 'object' && typeof stored.enabled === 'boolean') {
      return stored;
    }
    options.getStore().set(TRIAGE_CONFIG_KEY, DEFAULT_TRIAGE_CONFIG);
    return DEFAULT_TRIAGE_CONFIG;
  });

  ipcMain.handle(TriageIpcChannel.SetConfig, async (_event, config: unknown) => {
    const sanitized = sanitizeTriageConfig(config);
    options.getStore().set(TRIAGE_CONFIG_KEY, sanitized);
    return sanitized;
  });
}

export function getTriageConfig(store: SqliteStore): TriageConfig {
  const stored = store.get<TriageConfig>(TRIAGE_CONFIG_KEY);
  if (stored && typeof stored === 'object' && typeof stored.enabled === 'boolean') {
    return sanitizeTriageConfig(stored);
  }
  store.set(TRIAGE_CONFIG_KEY, DEFAULT_TRIAGE_CONFIG);
  return DEFAULT_TRIAGE_CONFIG;
}

function sanitizeTriageConfig(raw: unknown): TriageConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_TRIAGE_CONFIG;
  const input = raw as Record<string, unknown>;

  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_TRIAGE_CONFIG.enabled,
    rules: {
      lightModelRef:
        typeof input.rules === 'object' && input.rules !== null
          ? String((input.rules as Record<string, unknown>).lightModelRef || '')
          : DEFAULT_TRIAGE_CONFIG.rules.lightModelRef,
      heavyModelRef:
        typeof input.rules === 'object' && input.rules !== null
          ? String((input.rules as Record<string, unknown>).heavyModelRef || '')
          : DEFAULT_TRIAGE_CONFIG.rules.heavyModelRef,
      maxConversationRoundsForTriage:
        typeof input.rules === 'object' && input.rules !== null
          ? Math.max(
              1,
              Number((input.rules as Record<string, unknown>).maxConversationRoundsForTriage) ||
                DEFAULT_TRIAGE_CONFIG.rules.maxConversationRoundsForTriage,
            )
          : DEFAULT_TRIAGE_CONFIG.rules.maxConversationRoundsForTriage,
      allowCrossProviderSwitch:
        typeof input.rules === 'object' && input.rules !== null
          ? Boolean((input.rules as Record<string, unknown>).allowCrossProviderSwitch)
          : DEFAULT_TRIAGE_CONFIG.rules.allowCrossProviderSwitch,
      cooldownRounds:
        typeof input.rules === 'object' && input.rules !== null
          ? Math.max(
              1,
              Number((input.rules as Record<string, unknown>).cooldownRounds) ||
                DEFAULT_TRIAGE_CONFIG.rules.cooldownRounds,
            )
          : DEFAULT_TRIAGE_CONFIG.rules.cooldownRounds,
      useLocalModelTriage:
        typeof input.rules === 'object' && input.rules !== null
          ? Boolean((input.rules as Record<string, unknown>).useLocalModelTriage)
          : DEFAULT_TRIAGE_CONFIG.rules.useLocalModelTriage,
      triageModelName:
        typeof input.rules === 'object' && input.rules !== null
          ? String((input.rules as Record<string, unknown>).triageModelName || '')
          : DEFAULT_TRIAGE_CONFIG.rules.triageModelName,
    },
  };
}
