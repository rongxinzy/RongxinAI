/** Cowork queue IPC: list, enqueue, update, delete, steer and follow-up. */
import { ipcMain } from 'electron';

import { getCoworkStore } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import { getCoworkImageRoot } from './coworkSessionImages';
import {
  CoworkQueueEnqueueSchema,
  CoworkQueueItemSchema,
  CoworkQueueSessionSchema,
  CoworkQueueUpdateSchema,
} from '../../shared/ipc/queueSchemas';
import { persistCoworkImageAttachments, slimQueuedMessagesForIpc } from '../coworkImageAttachments';
import { CoworkQueueIpc } from '../../shared/ipc/channels';

export const registerCoworkQueueIpc = (): void => {
  ipcMain.handle(CoworkQueueIpc.List, async (_event, rawInput: unknown) => {
    try {
      const sessionId = CoworkQueueSessionSchema.parse(rawInput);
      return {
        success: true,
        items: slimQueuedMessagesForIpc(getPiRuntimeAdapter().listPendingMessages(sessionId)),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list pending messages',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Enqueue, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueEnqueueSchema.parse(rawInput);
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
        success: false,
        error: error instanceof Error ? error.message : 'Failed to enqueue pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Update, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueUpdateSchema.parse(rawInput);
      return getPiRuntimeAdapter().updatePendingMessage(input.sessionId, input.itemId, input.text);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Delete, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueItemSchema.parse(rawInput);
      return getPiRuntimeAdapter().deletePendingMessage(input.sessionId, input.itemId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.Steer, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueItemSchema.parse(rawInput);
      return await getPiRuntimeAdapter().steerPendingMessage(input.sessionId, input.itemId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to steer pending message',
      };
    }
  });

  ipcMain.handle(CoworkQueueIpc.FollowUp, async (_event, rawInput: unknown) => {
    try {
      const input = CoworkQueueItemSchema.parse(rawInput);
      return await getPiRuntimeAdapter().followUpPendingMessage(input.sessionId, input.itemId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send follow-up message',
      };
    }
  });
};
