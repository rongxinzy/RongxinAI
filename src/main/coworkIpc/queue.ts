/**
 * Cowork queue IPC: list and enqueue
 * (work package I: domain-owned registration with injected deps).
 */
import { handleIpcContract } from '../ipc/handleIpcContract';
import { coworkQueueContract } from '../../shared/ipc/coworkContract';
import { slimQueuedMessagesForIpc } from '../coworkImageAttachments';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';

export interface CoworkQueueIpcDeps {
  getPiRuntimeAdapter: () => PiRuntimeAdapter;
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

    enqueuePendingMessage: async (_event, input) => {
      try {
        return await deps
          .getPiRuntimeAdapter()
          .enqueuePendingMessage(
            input.sessionId,
            input.text,
            input.imageAttachments,
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
