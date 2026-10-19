import { app } from 'electron';

import type {
  LlamaCppLatestModelLaunchLogSessionInput,
  LlamaCppModelLaunchLogClearedEvent,
  LlamaCppModelLaunchLogEvent,
  LlamaCppOpenModelLaunchLogWindowInput,
  LlamaCppReadModelLaunchLogFileInput,
} from '../../shared/llamacpp';
import {
  LlamaCppIpcChannel,
  LlamaCppModelLaunchLogPhase,
  LlamaCppModelLaunchLogSource,
} from '../../shared/llamacpp';
import { createLlamaCppModelLaunchLogFileStore } from '../libs/llamacppModelLaunchLogFile';
import { openLlamaCppModelLaunchLogWindow } from '../libs/llamacppModelLaunchLogWindow';
import { llamacppContract } from '../../shared/ipc/llamacppContract';
import { handleIpcContract, handleIpcContractSubset } from '../ipc/handleIpcContract';

export function registerLlamaCppModelLaunchLogIpcHandlers(input: {
  broadcast: (channel: string, payload: unknown) => void;
}): {
  clearModelLaunchLog: (modelName: string) => void;
  sendModelLaunchLog: (event: LlamaCppModelLaunchLogEvent) => void;
} {
  const modelLaunchLogFiles = createLlamaCppModelLaunchLogFileStore({
    userDataPath: app.getPath('userData'),
  });
  const impls: Record<string, unknown> = {};
  const registerImpl = (method: string, fn: unknown): void => {
    impls[method] = fn;
  };

  registerImpl(
    'getLatestModelLaunchLogSession',
    (_event: unknown, request?: LlamaCppLatestModelLaunchLogSessionInput) =>
      modelLaunchLogFiles.getLatestSession(request?.modelName),
  );

  registerImpl(
    'readModelLaunchLogFile',
    (_event: unknown, request?: LlamaCppReadModelLaunchLogFileInput) => {
      const sessionId = request?.sessionId?.trim();
      if (!sessionId) {
        return {
          success: false,
          error: 'Model launch log session id is required.',
        };
      }

      const result = modelLaunchLogFiles.readSessionLog(sessionId, request?.offset);
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
        startOffset: result.startOffset,
        nextOffset: result.nextOffset,
      };
    },
  );

  registerImpl(
    'openModelLaunchLogWindow',
    async (_event: unknown, request?: LlamaCppOpenModelLaunchLogWindowInput) => {
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

  // The subset signature cannot name K here; keys drive registration and the
  // values are the closures collected above.
  handleIpcContractSubset(
    llamacppContract,
    impls as {
      getLatestModelLaunchLogSession: never;
      readModelLaunchLogFile: never;
      openModelLaunchLogWindow: never;
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
      if (
        event.source === LlamaCppModelLaunchLogSource.ProcessOutput ||
        event.phase === LlamaCppModelLaunchLogPhase.Failed
      ) {
        try {
          modelLaunchLogFiles.append(event);
        } catch (error) {
          console.warn('[LlamaCpp] Failed to write model launch log file:', error);
        }
      }
      input.broadcast(LlamaCppIpcChannel.ModelLaunchLog, event);
    },
  };
}
