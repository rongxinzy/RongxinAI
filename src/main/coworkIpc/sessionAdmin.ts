/** Cowork session admin IPC: stop, compact, save, list, delete and update model. */
import {
  forgetCoworkSession,
  getCoworkImageRoot,
  scheduleBackgroundMaterialize,
} from '../appBootstrap/coworkSessionImages';
import {
  sanitizeCoworkSessionForIpc,
  slimCoworkMessageForIpc,
} from '../appBootstrap/ipcPayloadSanitize';
import { persistMessageImageMetadata } from '../coworkImageAttachments';
import {
  coerceImportedSessionStatus,
  reconcileWorkSessionRuntimeState,
} from '../coworkSessionRuntimeState';
import type { CoworkMessageMetadata, CoworkMessageType } from '../coworkStore';
import { parseCoworkExecutionMode } from '../../shared/cowork/executionMode';
import type { CoworkStore } from '../coworkStore';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { coworkSessionAdminContract } from '../../shared/ipc/coworkContract';
import type { z } from 'zod';
import { assertInteractiveCoworkSession } from './interactiveSession';

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
  CoworkExecutionMode,
  CoworkSessionSource,
  normalizeRenamedSessionTitle,
  type CoworkCompactResult,
  COWORK_MESSAGE_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
} from '../../shared/cowork/constants';

export interface CoworkSessionAdminIpcDeps {
  getCoworkStore: () => CoworkStore;
  getPiRuntimeAdapter: () => PiRuntimeAdapter;
}

async function deleteCoworkSessions(
  deps: CoworkSessionAdminIpcDeps,
  sessionIds: string[],
): Promise<void> {
  for (const sessionId of sessionIds) await forgetCoworkSession(sessionId);
  const store = deps.getCoworkStore();
  const finalizations = sessionIds.flatMap(sessionId => {
    const session = store.getSessionFinalizationSnapshot(sessionId);
    return session
      ? [
          {
            sessionId,
            workingDirectory: session.cwd,
            summary: `## Goal\n${session.title}\n\n## Accomplished\n${(session.lastAssistantContent ?? '').slice(0, 1500)}`,
          },
        ]
      : [];
  });
  const memory = deps.getPiRuntimeAdapter().getProjectMemoryService();
  if (memory) {
    memory.finalizeSessionsForDeletion(finalizations, () => store.deleteSessions(sessionIds));
  } else {
    store.deleteSessions(sessionIds);
  }
}

export const registerCoworkSessionAdminIpc = (deps: CoworkSessionAdminIpcDeps): void => {
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
        assertInteractiveCoworkSession(deps.getCoworkStore(), sessionId);
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

    saveSession: async (_event, session) => {
      try {
        assertInteractiveCoworkSession(deps.getCoworkStore(), session.id);
        const existing = deps.getCoworkStore().getSession(session.id);
        if (existing) {
          // Session already exists — update status and sync new messages
          deps.getCoworkStore().updateSession(session.id, {
            status: coerceImportedSessionStatus(session.status),
          });
          for (const msg of session.messages || []) {
            deps.getCoworkStore().upsertMessage(session.id, {
              id: msg.id,
              type: msg.type as CoworkMessageType,
              content: msg.content,
              timestamp: msg.timestamp,
              metadata: persistMessageImageMetadata(getCoworkImageRoot(), session.id, msg.metadata)
                .metadata as CoworkMessageMetadata | undefined,
            });
          }
          // Imported messages are a display projection; explicitly invalidate
          // the previous execution state before accepting a new native input.
          if (session.messages?.length) {
            await deps.getPiRuntimeAdapter().invalidatePiSessionDir(session.id);
          }
          const updated = deps.getCoworkStore().getSession(session.id);
          return {
            success: true as const,
            session: updated ? sanitizeCoworkSessionForIpc(updated) : updated,
          };
        }
        // Create new session in SQLite
        const newSession = deps
          .getCoworkStore()
          .createSession(
            session.title,
            session.cwd,
            session.systemPrompt || '',
            parseCoworkExecutionMode(session.executionMode) ?? CoworkExecutionMode.Local,
            session.activeSkillIds || [],
            session.agentId || 'main',
            session.modelOverride || '',
            session.mode || 'work',
            session.id,
          );
        // Save messages
        for (const msg of session.messages || []) {
          deps.getCoworkStore().upsertMessage(newSession.id, {
            id: msg.id,
            type: msg.type as CoworkMessageType,
            content: msg.content,
            timestamp: msg.timestamp,
            metadata: persistMessageImageMetadata(getCoworkImageRoot(), newSession.id, msg.metadata)
              .metadata as CoworkMessageMetadata | undefined,
          });
        }
        // Imported sessions are history: a 'running' status can never be live.
        deps.getCoworkStore().updateSession(newSession.id, {
          status: coerceImportedSessionStatus(session.status),
        });
        const saved = deps.getCoworkStore().getSession(newSession.id);
        return {
          success: true as const,
          session: saved ? sanitizeCoworkSessionForIpc(saved) : saved,
        };
      } catch (error) {
        console.error('[Cowork] Failed to save session:', error);
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },

    deleteSession: async (_event, sessionId) => {
      try {
        await deleteCoworkSessions(deps, [sessionId]);
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
        await deleteCoworkSessions(deps, sessionIds);
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
        assertInteractiveCoworkSession(localStore, input.sessionId);
        const existing = localStore.getSession(input.sessionId, 0);
        if (!existing) {
          return { success: false as const, error: 'Session not found' };
        }
        localStore.updateSession(
          input.sessionId,
          { modelOverride: input.modelOverride },
          { touchUpdatedAt: false },
        );
        return { success: true as const, session: localStore.getSession(input.sessionId, 0) };
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

        // Derive only: the runtime is the running authority; read paths do
        // not heal the persisted row (startup reset / quit / relocation do).
        const reconciledSession = reconcileWorkSessionRuntimeState(
          session,
          deps.getPiRuntimeAdapter().isSessionRunning(sessionId),
        );
        return { success: true as const, session: sanitizeCoworkSessionForIpc(reconciledSession) };
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
        const sessions = localStore
          .listSessions(limit, offset, agentId, workspaceId, mode, sources)
          .map(session =>
            reconcileWorkSessionRuntimeState(
              session,
              deps.getPiRuntimeAdapter().isSessionRunning(session.id),
            ),
          );
        const total = localStore.countSessions(agentId, workspaceId, mode, sources);
        return { success: true as const, sessions, hasMore: offset + sessions.length < total };
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
        const localStore = deps.getCoworkStore();
        if (!localStore.getSession(sessionId, 0, { includeArtifacts: false })) {
          return { success: true as const, messages: [], offset, total: 0 };
        }
        const total = localStore.countSessionMessages(sessionId);
        const messages = localStore.getPagedSessionMessages(sessionId, limit, offset);
        scheduleBackgroundMaterialize(sessionId, messages);
        return {
          success: true as const,
          messages: messages.map(message => slimCoworkMessageForIpc(message)) as CoworkMessageIpc[],
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
