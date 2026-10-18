/** Cowork queue IPC: list, enqueue, update, delete, steer and follow-up. */
import { handleIpcContract } from '../ipc/handleIpcContract';
import { getCoworkStore } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import { getCoworkImageRoot } from './coworkSessionImages';
import { coworkQueueContract } from '../../shared/ipc/coworkContract';
import { persistCoworkImageAttachments, slimQueuedMessagesForIpc } from '../coworkImageAttachments';

export const registerCoworkQueueIpc = (): void => {
  handleIpcContract(coworkQueueContract, {
    listPendingMessages: (_event, sessionId) => {
      try {
        return {
          success: true as const,
          items: slimQueuedMessagesForIpc(getPiRuntimeAdapter().listPendingMessages(sessionId)),
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
              getCoworkImageRoot(),
              input.sessionId,
              input.imageAttachments,
            )
          : undefined;
        // Attaching a skill is a session-level action: a queued input's picks join
        // the session's capability set like a directly submitted one. Commit them
        // only once the queue accepts the item, so a rejected enqueue (e.g. the
        // turn settled first) cannot leave a skill active that nothing revealed.
        const enqueueResult = getPiRuntimeAdapter().enqueuePendingMessage(
          input.sessionId,
          input.text,
          storedImages,
          input.fileAttachments,
          input.skillIds,
        );
        if (enqueueResult.success && input.skillIds?.length) {
          const queuedSession = getCoworkStore().getSession(input.sessionId, 0);
          if (queuedSession) {
            getCoworkStore().updateSession(
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
        return getPiRuntimeAdapter().updatePendingMessage(
          input.sessionId,
          input.itemId,
          input.text,
        );
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to update pending message',
        };
      }
    },

    deletePendingMessage: (_event, input) => {
      try {
        return getPiRuntimeAdapter().deletePendingMessage(input.sessionId, input.itemId);
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to delete pending message',
        };
      }
    },

    steerPendingMessage: async (_event, input) => {
      try {
        return await getPiRuntimeAdapter().steerPendingMessage(input.sessionId, input.itemId);
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to steer pending message',
        };
      }
    },

    followUpPendingMessage: async (_event, input) => {
      try {
        return await getPiRuntimeAdapter().followUpPendingMessage(input.sessionId, input.itemId);
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to send follow-up message',
        };
      }
    },
  });
};
