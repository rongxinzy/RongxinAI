// Config kv access for the CoworkStore class chain.
// Split from src/main/coworkStore.ts (issue #1069).
import { CoworkExecutionMode, CoworkPermissionMode } from '../../shared/cowork/constants';
import {
  DEFAULT_EMBEDDING_ENABLED,
  DEFAULT_EMBEDDING_LOCAL_MODEL_PATH,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_PROVIDER,
  DEFAULT_EMBEDDING_REMOTE_API_KEY,
  DEFAULT_EMBEDDING_REMOTE_BASE_URL,
  getDefaultSystemPrompt,
  getDefaultWorkingDirectory,
  parseBooleanConfig,
  parseEmbeddingVectorWeight,
  normalizePermissionMode,
} from './helpers';
import { CoworkSessionStore } from './sessionStore';
import type { CoworkConfig, CoworkConfigUpdate } from './types';

export class CoworkConfigStore extends CoworkSessionStore {
  // Config operations
  getConfig(): CoworkConfig {
    const configKeys = [
      'workingDirectory',
      'executionMode',
      'permissionMode',
      'permissionModeBySession',
      'embeddingEnabled',
      'embeddingProvider',
      'embeddingModel',
      'embeddingLocalModelPath',
      'embeddingVectorWeight',
      'embeddingRemoteBaseUrl',
      'embeddingRemoteApiKey',
      'codemodeEnabled',
      'mcpNativeBridge',
    ] as const;
    const configRows = this.getAll<{ key: string; value: string }>(
      `SELECT key, value FROM cowork_config WHERE key IN (${configKeys.map(() => '?').join(', ')})`,
      [...configKeys],
    );
    const cfg = new Map(configRows.map(r => [r.key, r.value]));

    return {
      workingDirectory: cfg.get('workingDirectory') || getDefaultWorkingDirectory(),
      systemPrompt: getDefaultSystemPrompt(),
      executionMode: CoworkExecutionMode.Local,
      permissionMode: normalizePermissionMode(cfg.get('permissionMode')),
      permissionModeBySession: (() => {
        try {
          const parsed = JSON.parse(cfg.get('permissionModeBySession') || '{}');
          if (!parsed || typeof parsed !== 'object') return {};
          return Object.fromEntries(
            Object.entries(parsed).filter(
              ([, value]) =>
                value === CoworkPermissionMode.Ask || value === CoworkPermissionMode.AllowAll,
            ),
          ) as Record<string, CoworkConfig['permissionMode']>;
        } catch {
          return {};
        }
      })(),
      embeddingEnabled: parseBooleanConfig(cfg.get('embeddingEnabled'), DEFAULT_EMBEDDING_ENABLED),
      embeddingProvider: cfg.get('embeddingProvider') || DEFAULT_EMBEDDING_PROVIDER,
      embeddingModel: cfg.get('embeddingModel') || DEFAULT_EMBEDDING_MODEL,
      embeddingLocalModelPath:
        cfg.get('embeddingLocalModelPath') || DEFAULT_EMBEDDING_LOCAL_MODEL_PATH,
      embeddingVectorWeight: parseEmbeddingVectorWeight(cfg.get('embeddingVectorWeight')),
      embeddingRemoteBaseUrl:
        cfg.get('embeddingRemoteBaseUrl') || DEFAULT_EMBEDDING_REMOTE_BASE_URL,
      embeddingRemoteApiKey: cfg.get('embeddingRemoteApiKey') || DEFAULT_EMBEDDING_REMOTE_API_KEY,
      codemodeEnabled: cfg.get('codemodeEnabled') === '1',
      mcpNativeBridge: cfg.get('mcpNativeBridge') === '1',
    };
  }

  setConfig(config: CoworkConfigUpdate): void {
    const now = Date.now();

    if (config.workingDirectory !== undefined) {
      this.upsertConfig('workingDirectory', config.workingDirectory, now);
    }
    if (config.executionMode !== undefined) {
      this.upsertConfig('executionMode', config.executionMode, now);
    }
    if (config.permissionMode !== undefined) {
      this.upsertConfig('permissionMode', normalizePermissionMode(config.permissionMode), now);
    }
    if (config.permissionModeBySession !== undefined) {
      this.upsertConfig(
        'permissionModeBySession',
        JSON.stringify(config.permissionModeBySession),
        now,
      );
    }
    if (config.embeddingEnabled !== undefined) {
      this.upsertConfig('embeddingEnabled', config.embeddingEnabled ? '1' : '0', now);
    }
    if (config.embeddingProvider !== undefined) {
      this.upsertConfig('embeddingProvider', String(config.embeddingProvider), now);
    }
    if (config.embeddingModel !== undefined) {
      this.upsertConfig('embeddingModel', String(config.embeddingModel), now);
    }
    if (config.embeddingLocalModelPath !== undefined) {
      this.upsertConfig('embeddingLocalModelPath', String(config.embeddingLocalModelPath), now);
    }
    if (config.embeddingVectorWeight !== undefined) {
      this.upsertConfig(
        'embeddingVectorWeight',
        String(Math.max(0, Math.min(1, config.embeddingVectorWeight))),
        now,
      );
    }
    if (config.embeddingRemoteBaseUrl !== undefined) {
      this.upsertConfig('embeddingRemoteBaseUrl', String(config.embeddingRemoteBaseUrl), now);
    }
    if (config.embeddingRemoteApiKey !== undefined) {
      this.upsertConfig('embeddingRemoteApiKey', String(config.embeddingRemoteApiKey), now);
    }
    if (config.codemodeEnabled !== undefined) {
      this.upsertConfig('codemodeEnabled', config.codemodeEnabled ? '1' : '0', now);
    }
    if (config.mcpNativeBridge !== undefined) {
      this.upsertConfig('mcpNativeBridge', config.mcpNativeBridge ? '1' : '0', now);
    }
  }

  getAppLanguage(): 'zh' | 'en' {
    interface KvRow {
      value: string;
    }

    const row = this.getOne<KvRow>('SELECT value FROM kv WHERE key = ?', ['app_config']);
    if (!row?.value) {
      return 'zh';
    }

    try {
      const config = JSON.parse(row.value) as { language?: string };
      return config.language === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  }
}
