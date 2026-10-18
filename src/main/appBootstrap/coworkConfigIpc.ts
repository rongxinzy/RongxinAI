/** Cowork config IPC: get/set configuration, embedding config, theme, proxy. */
import { getCoworkStore, getSkillManager } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import { parseCoworkExecutionMode } from '../../shared/cowork/executionMode';
import { getChangedSessionPermissionModes } from '../coworkPermissionModeChanges';
import { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import type { CoworkStore } from '../coworkStore';
import { CoworkPermissionMode } from '../../shared/cowork/constants';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { coworkConfigContract } from '../../shared/ipc/coworkContract';

export const registerCoworkConfigIpc = (): void => {
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

  handleIpcContract(coworkConfigContract, {
    getConfig: async () => {
      try {
        const config = getCoworkStore().getConfig();
        return { success: true as const, config };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to get config',
        };
      }
    },

    setConfig: async (_event, config) => {
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

        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to set config',
        };
      }
    },
  });
};
