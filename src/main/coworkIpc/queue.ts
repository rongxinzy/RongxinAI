/**
 * Cowork queue IPC: list, enqueue, update, delete, steer and follow-up
 * (work package I: domain-owned registration with injected deps).
 */
import { handleIpcContract } from '../ipc/handleIpcContract';
import { coworkQueueContract } from '../../shared/ipc/coworkContract';
import { persistCoworkImageAttachments, slimQueuedMessagesForIpc } from '../coworkImageAttachments';
import type { CoworkStore } from '../coworkStore';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';

export interface CoworkQueueIpcDeps {
  getPiRuntimeAdapter: () => PiRuntimeAdapter;
  getCoworkStore: () => CoworkStore;
  getCoworkImageRoot: () => string;
}

export const registerCoworkQueueIpc = (deps: CoworkQueueIpcDeps): void => {
  handleIpcContract(coworkQueueContract, {
    listPendingMessages: (_event, sessionId) => {
      try {
        return {
          success: true as const,
          items: slimQueuedMessagesForIpc(
            deps.getPiRuntimeAdapter().listPendingMessages(sessionId),
          ),
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to list pending messages',
        };
      }
    },

    enqueuePendingMessage: (_event, input) => {
      try {
        const storedImages = input.imageAttachments?.length
          ? persistCoworkImageAttachments(
              deps.getCoworkImageRoot(),
              input.sessionId,
              input.imageAttachments,
            )
          : undefined;
        // Attaching a skill is a session-level action: a queued input's picks join
        // the session's capability set like a directly submitted one. Commit them
        // only once the queue accepts the item, so a rejected enqueue (e.g. the
        // turn settled first) cannot leave a skill active that nothing revealed.
        const enqueueResult = deps
          .getPiRuntimeAdapter()
          .enqueuePendingMessage(
            input.sessionId,
            input.text,
            storedImages,
            input.fileAttachments,
            input.skillIds,
          );
        if (enqueueResult.success && input.skillIds?.length) {
          const queuedSession = deps.getCoworkStore().getSession(input.sessionId, 0);
          if (queuedSession) {
            deps.getCoworkStore().updateSession(
              input.sessionId,
              {
                activeSkillIds: [...new Set([...queuedSession.activeSkillIds, ...input.skillIds])],
              },
              { touchUpdatedAt: false },
            );
          }
        }
        return enqueueResult;
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to enqueue pending message',
        };
      }
    },

    updatePendingMessage: (_event, input) => {
      try {
        return deps
          .getPiRuntimeAdapter()
          .updatePendingMessage(input.sessionId, input.itemId, input.text);
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to update pending message',
        };
      }
    },

    deletePendingMessage: (_event, input) => {
      try {
        return deps.getPiRuntimeAdapter().deletePendingMessage(input.sessionId, input.itemId);
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to delete pending message',
        };
      }
    },

    steerPendingMessage: async (_event, input) => {
      try {
        return await deps.getPiRuntimeAdapter().steerPendingMessage(input.sessionId, input.itemId);
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to steer pending message',
        };
      }
    },

    followUpPendingMessage: async (_event, input) => {
      try {
        return await deps
          .getPiRuntimeAdapter()
          .followUpPendingMessage(input.sessionId, input.itemId);
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to send follow-up message',
        };
      }
    },
  });
};
