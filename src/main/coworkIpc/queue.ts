/**
 * Cowork queue IPC: list and enqueue
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
        return deps
          .getPiRuntimeAdapter()
          .enqueuePendingMessage(
            input.sessionId,
            input.text,
            storedImages,
            input.fileAttachments,
            input.skillIds,
          );
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to enqueue pending message',
        };
      }
    },
  });
};
