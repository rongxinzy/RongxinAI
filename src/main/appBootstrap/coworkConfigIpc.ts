/** Cowork config IPC: get/set configuration, embedding config, theme, proxy. */
import { ipcMain } from 'electron';

import { rt } from './runtimeState';
import { getCoworkStore, getSkillManager, getStore } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import { parseCoworkExecutionMode } from '../../shared/cowork/executionMode';
import { getChangedSessionPermissionModes } from '../coworkPermissionModeChanges';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import { applyProxyPreference, getUseSystemProxyFromConfig } from './appConfigSettings';
import type { CoworkStore } from '../coworkStore';
import { CoworkExecutionMode, CoworkPermissionMode } from '../../shared/cowork/constants';

export const registerCoworkConfigIpc = (): void => {
  ipcMain.handle('cowork:config:get', async () => {
    try {
      const config = getCoworkStore().getConfig();
      return { success: true, config };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get config',
      };
    }
  });

  const VALID_EMBEDDING_PROVIDERS = [
    'local',
    'openai',
    'gemini',
    'voyage',
    'mistral',
    'ollama',
  ] as const;

  function normalizeEmbeddingConfig(config: {
    embeddingEnabled?: boolean;
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingLocalModelPath?: string;
    embeddingVectorWeight?: number;
    embeddingRemoteBaseUrl?: string;
    embeddingRemoteApiKey?: string;
  }) {
    return {
      embeddingEnabled:
        typeof config.embeddingEnabled === 'boolean' ? config.embeddingEnabled : undefined,
      embeddingProvider:
        typeof config.embeddingProvider === 'string' &&
        (VALID_EMBEDDING_PROVIDERS as readonly string[]).includes(config.embeddingProvider)
          ? config.embeddingProvider
          : undefined,
      embeddingModel:
        typeof config.embeddingModel === 'string' ? config.embeddingModel.trim() : undefined,
      embeddingLocalModelPath:
        typeof config.embeddingLocalModelPath === 'string'
          ? config.embeddingLocalModelPath.trim()
          : undefined,
      embeddingVectorWeight:
        typeof config.embeddingVectorWeight === 'number' &&
        Number.isFinite(config.embeddingVectorWeight)
          ? Math.max(0, Math.min(1, config.embeddingVectorWeight))
          : undefined,
      embeddingRemoteBaseUrl:
        typeof config.embeddingRemoteBaseUrl === 'string'
          ? config.embeddingRemoteBaseUrl.trim()
          : undefined,
      embeddingRemoteApiKey:
        typeof config.embeddingRemoteApiKey === 'string'
          ? config.embeddingRemoteApiKey.trim()
          : undefined,
    };
  }

  ipcMain.handle(
    'cowork:config:set',
    async (
      _event,
      config: {
        workingDirectory?: string;
        executionMode?: CoworkExecutionMode;
        permissionMode?: CoworkPermissionMode;
        permissionModeBySession?: Record<string, CoworkPermissionMode>;
        embeddingEnabled?: boolean;
        embeddingProvider?: string;
        embeddingModel?: string;
        embeddingLocalModelPath?: string;
        embeddingVectorWeight?: number;
        embeddingRemoteBaseUrl?: string;
        embeddingRemoteApiKey?: string;
        codemodeEnabled?: boolean;
        mcpNativeBridge?: boolean;
      },
    ) => {
      try {
        const normalizedPermissionMode =
          config.permissionMode === CoworkPermissionMode.Ask ||
          config.permissionMode === CoworkPermissionMode.AllowAll
            ? config.permissionMode
            : undefined;
        const normalizedPermissionModeBySession =
          config.permissionModeBySession && typeof config.permissionModeBySession === 'object'
            ? Object.fromEntries(
                Object.entries(config.permissionModeBySession).filter(
                  ([, value]) =>
                    value === CoworkPermissionMode.Ask || value === CoworkPermissionMode.AllowAll,
                ),
              )
            : undefined;
        const normalizedEmbedding = normalizeEmbeddingConfig(config);
        const normalizedConfig: Parameters<CoworkStore['setConfig']>[0] = {
          ...config,
          executionMode: parseCoworkExecutionMode(config.executionMode),
          permissionMode: normalizedPermissionMode,
          permissionModeBySession: normalizedPermissionModeBySession,
          codemodeEnabled:
            typeof config.codemodeEnabled === 'boolean' ? config.codemodeEnabled : undefined,
          mcpNativeBridge:
            typeof config.mcpNativeBridge === 'boolean' ? config.mcpNativeBridge : undefined,
          ...normalizedEmbedding,
        };
        const previousConfig = getCoworkStore().getConfig();
        const previousWorkingDir = previousConfig.workingDirectory;
        getCoworkStore().setConfig(normalizedConfig);
        if (normalizedPermissionModeBySession !== undefined) {
          for (const [sessionId, mode] of getChangedSessionPermissionModes(
            previousConfig.permissionModeBySession ?? {},
            normalizedPermissionModeBySession,
            normalizedPermissionMode ?? previousConfig.permissionMode,
          )) {
            getPiRuntimeAdapter().setApprovalModeForSession(
              sessionId,
              mode === CoworkPermissionMode.AllowAll
                ? WorkbenchApprovalMode.AllowAll
                : WorkbenchApprovalMode.Ask,
            );
          }
        }
        if (
          normalizedConfig.workingDirectory !== undefined &&
          normalizedConfig.workingDirectory !== previousWorkingDir
        ) {
          getSkillManager().handleWorkingDirectoryChange();
          // Main agent workspace is decoupled from workingDirectory — no MEMORY.md
          // sync needed here. The workspace is always at
          // {STATE_DIR}/workspace-main/ regardless of the user's working directory.
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set config',
        };
      }
    },
  );
};
