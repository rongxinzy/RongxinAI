import { app, ipcMain } from 'electron';

import type {
  LlamaCppLatestModelLaunchLogSessionInput,
  LlamaCppModelLaunchLogClearedEvent,
  LlamaCppModelLaunchLogEvent,
  LlamaCppOpenModelLaunchLogWindowInput,
  LlamaCppReadModelLaunchLogFileInput,
} from '../../shared/llamacpp';
import { LlamaCppIpcChannel } from '../../shared/llamacpp';
import { createLlamaCppModelLaunchLogFileStore } from '../libs/llamacppModelLaunchLogFile';
import { openLlamaCppModelLaunchLogWindow } from '../libs/llamacppModelLaunchLogWindow';

export function registerLlamaCppModelLaunchLogIpcHandlers(input: {
  broadcast: (channel: string, payload: unknown) => void;
}): {
  clearModelLaunchLog: (modelName: string) => void;
  sendModelLaunchLog: (event: LlamaCppModelLaunchLogEvent) => void;
} {
  const modelLaunchLogFiles = createLlamaCppModelLaunchLogFileStore({
    userDataPath: app.getPath('userData'),
  });

  ipcMain.handle(
    LlamaCppIpcChannel.GetLatestModelLaunchLogSession,
    (_event, request?: LlamaCppLatestModelLaunchLogSessionInput) =>
      modelLaunchLogFiles.getLatestSession(request?.modelName),
  );

  ipcMain.handle(
    LlamaCppIpcChannel.ReadModelLaunchLogFile,
    (_event, request?: LlamaCppReadModelLaunchLogFileInput) => {
      const sessionId = request?.sessionId?.trim();
      if (!sessionId) {
        return {
          success: false,
          error: 'Model launch log session id is required.',
        };
      }

      const result = modelLaunchLogFiles.readSessionLog(sessionId);
      if (!result) {
        return {
          success: false,
          error: 'Model launch log session was not found.',
        };
      }

      return {
        success: true,
        session: result.session,
        content: result.content,
      };
    },
  );

  ipcMain.handle(
    LlamaCppIpcChannel.OpenModelLaunchLogWindow,
    async (_event, request?: LlamaCppOpenModelLaunchLogWindowInput) => {
      const sessionId = request?.sessionId?.trim();
      const modelName = request?.modelName?.trim();
      const session = sessionId
        ? modelLaunchLogFiles.getSession(sessionId)
        : modelLaunchLogFiles.getLatestSession(modelName);
      const windowInput = {
        ...(session ? { sessionId: session.sessionId, modelName: session.modelName } : {}),
        ...(!sessionId && modelName ? { modelName } : {}),
      };

      try {
        await openLlamaCppModelLaunchLogWindow(windowInput);
        return {
          success: true,
          ...(session ? { session } : {}),
        };
      } catch (error) {
        console.error('[LlamaCpp] Failed to open model launch log window:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  return {
    clearModelLaunchLog: (modelName: string) => {
      const normalizedModelName = modelName.trim();
      if (!normalizedModelName) return;
      modelLaunchLogFiles.clearModel(normalizedModelName);
      const event: LlamaCppModelLaunchLogClearedEvent = { modelName: normalizedModelName };
      input.broadcast(LlamaCppIpcChannel.ModelLaunchLogCleared, event);
    },

    sendModelLaunchLog: (event: LlamaCppModelLaunchLogEvent) => {
      try {
        modelLaunchLogFiles.append(event);
      } catch (error) {
        console.warn('[LlamaCpp] Failed to write model launch log file:', error);
      }
      input.broadcast(LlamaCppIpcChannel.ModelLaunchLog, event);
    },
  };
}
