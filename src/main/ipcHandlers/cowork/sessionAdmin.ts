/** Cowork session admin IPC: stop, compact, list, delete, update model, remote managed. */
import { scheduleBackgroundMaterialize } from '../../appBootstrap/coworkSessionImages';
import {
  sanitizeCoworkSessionForIpc,
  slimCoworkMessageForIpc,
} from '../../appBootstrap/ipcPayloadSanitize';
import { projectCoworkSessionRuntimeState } from '../../coworkSessionRuntimeState';
import type { IMStore } from '../../im/imStore';
import type { CoworkStore } from '../../coworkStore';
import type { PiRuntimeAdapter } from '../../libs/agentEngine/piRuntimeAdapter';
import { handleIpcContract } from '../../ipc/handleIpcContract';
import { coworkSessionAdminContract } from '../../../shared/ipc/coworkContract';
import type { z } from 'zod';

/** Message row as pinned by the contract's `getSessionMessages` result. */
type CoworkMessageIpc = z.infer<
  typeof coworkSessionAdminContract.getSessionMessages.result extends z.ZodObject<infer S>
    ? S['messages'] extends z.ZodOptional<z.ZodArray<infer T>> | z.ZodArray<infer T>
      ? T
      : never
    : never
>;
import {
  CoworkCompactFailure,
  CoworkSessionSource,
  normalizeRenamedSessionTitle,
  type CoworkCompactResult,
  COWORK_MESSAGE_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
} from '../../../shared/cowork/constants';

export interface CoworkSessionAdminIpcDeps {
  getCoworkStore: () => CoworkStore;
  getPiRuntimeAdapter: () => PiRuntimeAdapter;
  getIMStore: () => Pick<IMStore, 'getSessionMappingByCoworkSessionId'>;
  deleteSessions: (sessionIds: string[]) => Promise<unknown>;
}

export const registerCoworkSessionAdminIpc = (deps: CoworkSessionAdminIpcDeps): void => {
  const liveMessageIds = (
    runtime: PiRuntimeAdapter,
    sessionId: string,
    running = runtime.isSessionRunning(sessionId),
  ) =>
    running
      ? new Set(runtime.getLiveStreamTexts(sessionId).map(stream => stream.messageId))
      : undefined;

  handleIpcContract(coworkSessionAdminContract, {
    stopSession: async (_event, sessionId) => {
      try {
        const runtime = deps.getPiRuntimeAdapter();
        runtime.stopSession(sessionId);
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to stop session',
        };
      }
    },

    // `/compact` from the composer: never becomes model input. While a turn is
    // in flight the compaction waits behind the queued prompts, otherwise it
    // runs now; failures are classified so the renderer can localize them.
    compactSession: async (_event, sessionId): Promise<CoworkCompactResult> => {
      try {
        const runtime = deps.getPiRuntimeAdapter();
        if (runtime.isSessionActive(sessionId) === false) {
          return { success: false, reason: CoworkCompactFailure.NoSession };
        }
        if (runtime.isSessionRunning(sessionId)) {
          const queued = runtime.enqueueControlAction(sessionId, async () => {
            try {
              await runtime.compactSession(sessionId);
            } catch (error) {
              console.error('[Cowork] queued session compaction failed:', error);
            }
          });
          return queued.success
            ? { success: true, queued: true }
            : { success: false, reason: CoworkCompactFailure.Busy };
        }
        try {
          const result = await runtime.compactSession(sessionId);
          return { success: true, queued: false, cancelled: result.cancelled };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/nothing to compact|session too small/i.test(message)) {
            return { success: false, reason: CoworkCompactFailure.NotNeeded };
          }
          // A retained-but-not-live session, or a turn that started between
          // the liveness check and the compact call.
          if (/not active/i.test(message)) {
            return { success: false, reason: CoworkCompactFailure.NoSession };
          }
          if (/still running/i.test(message)) {
            return { success: false, reason: CoworkCompactFailure.Busy };
          }
          throw error;
        }
      } catch (error) {
        console.error('[Cowork] session compaction failed:', error);
        return { success: false, reason: CoworkCompactFailure.Failed };
      }
    },

    deleteSession: async (_event, sessionId) => {
      try {
        await deps.deleteSessions([sessionId]);
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to delete session',
        };
      }
    },

    deleteSessions: async (_event, sessionIds) => {
      try {
        await deps.deleteSessions(sessionIds);
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to batch delete sessions',
        };
      }
    },

    setSessionPinned: async (_event, options) => {
      try {
        const coworkStoreInstance = deps.getCoworkStore();
        const pinOrder = coworkStoreInstance.setSessionPinned(options.sessionId, options.pinned);
        return { success: true as const, pinOrder };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to update session pin',
        };
      }
    },

    renameSession: async (_event, options) => {
      try {
        const coworkStoreInstance = deps.getCoworkStore();
        // Scheduled rows are identified by their `source`; the stored title keeps
        // the canonical prefix so it cannot drift from migrated/renamed rows.
        const existing = coworkStoreInstance.getSession(options.sessionId, 0);
        const title = normalizeRenamedSessionTitle(
          options.title,
          existing?.source === CoworkSessionSource.Scheduled,
        ).trim();
        if (!title) {
          return { success: false as const, error: 'Title is required' };
        }
        coworkStoreInstance.updateSession(
          options.sessionId,
          { title },
          { userInitiatedTitleChange: true },
        );
        // Report the stored (normalized) title: the renderer echoes this value
        // into redux, and a scheduled rename adds the canonical prefix.
        return { success: true as const, title };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to rename session',
        };
      }
    },

    updateSessionModel: async (_event, input) => {
      try {
        const localStore = deps.getCoworkStore();
        const existing = localStore.getSession(input.sessionId, 0);
        if (!existing) {
          return { success: false as const, error: 'Session not found' };
        }
        localStore.updateSession(
          input.sessionId,
          { modelOverride: input.modelOverride },
          { touchUpdatedAt: false },
        );
        const session = localStore.getSession(input.sessionId, 0);
        return {
          success: true as const,
          session:
            session &&
            projectCoworkSessionRuntimeState(
              session,
              deps.getPiRuntimeAdapter().isSessionRunning(session.id),
            ),
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to update session model',
        };
      }
    },

    getSession: async (_event, sessionId, options) => {
      try {
        const localStore = deps.getCoworkStore();
        // Default: latest page only for the main transcript UI. Callers that need
        // the full history (e.g. scheduled-task run viewer) pass messageLimit: null.
        const session =
          options && 'messageLimit' in options
            ? localStore.getSession(sessionId, options.messageLimit)
            : localStore.getSession(sessionId);
        if (!session) return { success: true as const, session: null };
        scheduleBackgroundMaterialize(sessionId, session.messages);

        const runtime = deps.getPiRuntimeAdapter();
        const running = runtime.isSessionRunning(sessionId);
        const projectedSession = projectCoworkSessionRuntimeState(session, running);
        return {
          success: true as const,
          session: sanitizeCoworkSessionForIpc(
            {
              ...projectedSession,
              remoteManaged: Boolean(
                deps.getIMStore().getSessionMappingByCoworkSessionId(sessionId),
              ),
            },
            liveMessageIds(runtime, sessionId, running),
          ),
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to get session',
        };
      }
    },

    listSessions: async (_event, options) => {
      try {
        const limit = options?.limit ?? COWORK_SESSION_PAGE_SIZE;
        const offset = options?.offset ?? 0;
        const agentId = options?.agentId;
        const workspaceId = options?.workspaceId;
        const mode = options?.mode;
        const sources = options?.sources;
        const localStore = deps.getCoworkStore();
        const runtime = deps.getPiRuntimeAdapter();
        const { sessions, hasMore } = localStore.listSessions(
          limit,
          offset,
          agentId,
          workspaceId,
          mode,
          sources,
        );
        return {
          success: true as const,
          sessions: sessions.map(session =>
            projectCoworkSessionRuntimeState(session, runtime.isSessionRunning(session.id)),
          ),
          hasMore,
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to list sessions',
        };
      }
    },

    getSessionMessages: async (_event, options) => {
      try {
        const { sessionId, limit = COWORK_MESSAGE_PAGE_SIZE, offset = 0 } = options;
        const messageStore = deps.getCoworkStore().messages;
        const total = messageStore.countSessionMessages(sessionId);
        const messages = messageStore.getPagedSessionMessages(sessionId, limit, offset);
        scheduleBackgroundMaterialize(sessionId, messages);
        const live = liveMessageIds(deps.getPiRuntimeAdapter(), sessionId);
        return {
          success: true as const,
          messages: messages.map(message =>
            slimCoworkMessageForIpc(message, live),
          ) as CoworkMessageIpc[],
          offset,
          total,
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to get session messages',
        };
      }
    },
  });
};
