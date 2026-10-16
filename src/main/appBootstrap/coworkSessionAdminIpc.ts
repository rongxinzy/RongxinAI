/** Cowork session admin IPC: stop, compact, save, list, delete, update model, remote managed. */
import { ipcMain } from 'electron';

import { rt } from './runtimeState';
import { getCoworkStore } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import {
  forgetCoworkSession,
  getCoworkImageRoot,
  scheduleBackgroundMaterialize,
} from './coworkSessionImages';
import { sanitizeCoworkSessionForIpc, slimCoworkMessageForIpc } from './ipcPayloadSanitize';
import { persistMessageImageMetadata } from '../coworkImageAttachments';
import { reconcileWorkSessionRuntimeState } from '../coworkSessionRuntimeState';
import type { CoworkMessageMetadata, CoworkMessageType, CoworkSessionStatus } from '../coworkStore';
import { parseCoworkExecutionMode } from '../../shared/cowork/executionMode';
import { getIMGatewayManager } from './ccConnectRuntime';
import { runWithCorrelationId } from '../libs/logCorrelation';
import { generateSessionTitle } from '../libs/coworkUtil';
import { CoworkSessionUpdateModelSchema } from '../../shared/ipc/schemas';
import {
  CoworkCompactFailure,
  CoworkExecutionMode,
  CoworkSessionMode,
  CoworkSessionSource,
  normalizeRenamedSessionTitle,
  type CoworkCompactResult,
  COWORK_MESSAGE_PAGE_SIZE,
  COWORK_SESSION_PAGE_SIZE,
} from '../../shared/cowork/constants';
import { CoworkSessionIpc } from '../../shared/ipc/channels';

export const registerCoworkSessionAdminIpc = (): void => {
  ipcMain.handle('cowork:session:stop', async (_event, sessionId: string) => {
    try {
      const runtime = getPiRuntimeAdapter();
      runtime.stopSession(sessionId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop session',
      };
    }
  });

  // `/compact` from the composer: never becomes model input. While a turn is
  // in flight the compaction waits behind the queued prompts, otherwise it
  // runs now; failures are classified so the renderer can localize them.
  ipcMain.handle(
    CoworkSessionIpc.Compact,
    async (_event, rawSessionId: unknown): Promise<CoworkCompactResult> => {
      try {
        const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
        const runtime = getPiRuntimeAdapter();
        if (!sessionId || runtime.isSessionActive(sessionId) === false) {
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
  );

  ipcMain.handle(
    'cowork:session:save',
    async (
      _event,
      session: {
        id: string;
        title: string;
        status: string;
        mode: 'work' | 'chat';
        cwd: string;
        systemPrompt: string;
        modelOverride: string;
        executionMode: string;
        activeSkillIds: string[];
        agentId: string;
        messages: Array<{
          id: string;
          type: string;
          content: string;
          timestamp: number;
          metadata?: Record<string, unknown>;
        }>;
      },
    ) => {
      try {
        const existing = rt.coworkStore.getSession(session.id);
        if (existing) {
          // Session already exists — update status and sync new messages
          rt.coworkStore.updateSession(session.id, {
            status: session.status as CoworkSessionStatus,
          });
          for (const msg of session.messages || []) {
            rt.coworkStore.upsertMessage(session.id, {
              id: msg.id,
              type: msg.type as CoworkMessageType,
              content: msg.content,
              timestamp: msg.timestamp,
              metadata: persistMessageImageMetadata(getCoworkImageRoot(), session.id, msg.metadata)
                .metadata as CoworkMessageMetadata | undefined,
            });
          }
          const updated = rt.coworkStore.getSession(session.id);
          return {
            success: true,
            session: updated ? sanitizeCoworkSessionForIpc(updated) : updated,
          };
        }
        // Create new session in SQLite
        const newSession = rt.coworkStore.createSession(
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
          rt.coworkStore.upsertMessage(newSession.id, {
            id: msg.id,
            type: msg.type as CoworkMessageType,
            content: msg.content,
            timestamp: msg.timestamp,
            metadata: persistMessageImageMetadata(getCoworkImageRoot(), newSession.id, msg.metadata)
              .metadata as CoworkMessageMetadata | undefined,
          });
        }
        // Update status
        rt.coworkStore.updateSession(newSession.id, {
          status: session.status as CoworkSessionStatus,
        });
        const saved = rt.coworkStore.getSession(newSession.id);
        return { success: true, session: saved ? sanitizeCoworkSessionForIpc(saved) : saved };
      } catch (error) {
        console.error('[Cowork] Failed to save session:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    },
  );

  ipcMain.handle('cowork:session:delete', async (_event, sessionId: string) => {
    try {
      // Purge runtime state first so late events cannot write to the session
      // after the DB row is removed.
      forgetCoworkSession(sessionId);
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSession(sessionId);
      // Clean up IM session mapping so that new channel messages
      // create a fresh session instead of referencing a deleted one.
      try {
        getIMGatewayManager()?.getIMStore()?.deleteSessionMappingByCoworkSessionId(sessionId);
      } catch {
        // IM rt.store may not be initialised yet; safe to ignore.
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete session',
      };
    }
  });

  ipcMain.handle('cowork:session:deleteBatch', async (_event, sessionIds: string[]) => {
    try {
      // Purge runtime state before deleting DB rows so late events cannot
      // recreate or write to sessions that are being removed.
      for (const sessionId of sessionIds) {
        forgetCoworkSession(sessionId);
      }
      const coworkStoreInstance = getCoworkStore();
      coworkStoreInstance.deleteSessions(sessionIds);
      for (const sessionId of sessionIds) {
        try {
          getIMGatewayManager()?.getIMStore()?.deleteSessionMappingByCoworkSessionId(sessionId);
        } catch {
          // IM rt.store may not be initialised yet; safe to ignore.
        }
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to batch delete sessions',
      };
    }
  });

  ipcMain.handle(
    'cowork:session:pin',
    async (_event, options: { sessionId: string; pinned: boolean }) => {
      try {
        const coworkStoreInstance = getCoworkStore();
        const pinOrder = coworkStoreInstance.setSessionPinned(options.sessionId, options.pinned);
        return { success: true, pinOrder };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update session pin',
        };
      }
    },
  );

  ipcMain.handle(
    'cowork:session:rename',
    async (_event, options: { sessionId: string; title: string }) => {
      try {
        const coworkStoreInstance = getCoworkStore();
        // Scheduled rows are identified by their `source`; the stored title keeps
        // the canonical prefix so it cannot drift from migrated/renamed rows.
        const existing = coworkStoreInstance.getSession(options.sessionId, 0);
        const title = normalizeRenamedSessionTitle(
          options.title,
          existing?.source === CoworkSessionSource.Scheduled,
        ).trim();
        if (!title) {
          return { success: false, error: 'Title is required' };
        }
        coworkStoreInstance.updateSession(
          options.sessionId,
          { title },
          { userInitiatedTitleChange: true },
        );
        // Report the stored (normalized) title: the renderer echoes this value
        // into redux, and a scheduled rename adds the canonical prefix.
        return { success: true, title };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to rename session',
        };
      }
    },
  );

  ipcMain.handle(CoworkSessionIpc.UpdateModel, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkSessionUpdateModelSchema.input.parse(rawInput);
      const localStore = getCoworkStore();
      const existing = localStore.getSession(input.sessionId, 0);
      if (!existing) {
        return { success: false, error: 'Session not found' };
      }
      localStore.updateSession(
        input.sessionId,
        { modelOverride: input.modelOverride },
        { touchUpdatedAt: false },
      );
      return { success: true, session: localStore.getSession(input.sessionId, 0) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update session model',
      };
    }
  });

  ipcMain.handle(
    CoworkSessionIpc.Get,
    async (_event, sessionId: string, options?: { messageLimit?: number | null }) => {
      try {
        const localStore = getCoworkStore();
        // Default: latest page only for the main transcript UI. Callers that need
        // the full history (e.g. scheduled-task run viewer) pass messageLimit: null.
        const session =
          options && 'messageLimit' in options
            ? localStore.getSession(sessionId, options.messageLimit)
            : localStore.getSession(sessionId);
        if (!session) return { success: true, session: null };
        scheduleBackgroundMaterialize(sessionId, session.messages);

        const reconciledSession = reconcileWorkSessionRuntimeState(
          session,
          getPiRuntimeAdapter().isSessionRunning(sessionId),
        );
        if (reconciledSession.status !== session.status) {
          localStore.updateSession(sessionId, { status: reconciledSession.status });
        }
        return { success: true, session: sanitizeCoworkSessionForIpc(reconciledSession) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get session',
        };
      }
    },
  );

  ipcMain.handle('cowork:session:remoteManaged', async (_event, sessionId: string) => {
    try {
      const mapping = getIMGatewayManager()
        ?.getIMStore()
        ?.getSessionMappingByCoworkSessionId(sessionId);
      return { success: true, remoteManaged: !!mapping };
    } catch (error) {
      return {
        success: false,
        remoteManaged: false,
        error: error instanceof Error ? error.message : 'Failed to check remote managed session',
      };
    }
  });

  ipcMain.handle(
    CoworkSessionIpc.List,
    async (
      _event,
      options?: {
        limit?: number;
        offset?: number;
        agentId?: string;
        workspaceId?: string;
        mode?: CoworkSessionMode;
        sources?: CoworkSessionSource[];
      },
    ) => {
      try {
        const limit = options?.limit ?? COWORK_SESSION_PAGE_SIZE;
        const offset = options?.offset ?? 0;
        const agentId = options?.agentId;
        const workspaceId = options?.workspaceId;
        const mode = options?.mode;
        const sources = options?.sources;
        const localStore = getCoworkStore();
        const sessions = localStore
          .listSessions(limit, offset, agentId, workspaceId, mode, sources)
          .map(session => {
            const reconciledSession = reconcileWorkSessionRuntimeState(
              session,
              getPiRuntimeAdapter().isSessionRunning(session.id),
            );
            if (reconciledSession.status !== session.status) {
              localStore.updateSession(session.id, { status: reconciledSession.status });
            }
            return reconciledSession;
          });
        const total = localStore.countSessions(agentId, workspaceId, mode, sources);
        return { success: true, sessions, hasMore: offset + sessions.length < total };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list sessions',
        };
      }
    },
  );

  ipcMain.handle(
    CoworkSessionIpc.GetMessages,
    async (_event, options: { sessionId: string; limit?: number; offset?: number }) => {
      try {
        const { sessionId, limit = COWORK_MESSAGE_PAGE_SIZE, offset = 0 } = options;
        const localStore = getCoworkStore();
        const total = localStore.countSessionMessages(sessionId);
        const messages = localStore.getPagedSessionMessages(sessionId, limit, offset);
        scheduleBackgroundMaterialize(sessionId, messages);
        return {
          success: true,
          messages: messages.map(message => slimCoworkMessageForIpc(message)),
          offset,
          total,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get session messages',
        };
      }
    },
  );
};
