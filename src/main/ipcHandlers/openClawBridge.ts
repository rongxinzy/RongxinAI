import { ipcMain } from 'electron';

import { CoworkPermissionBehavior } from '../../shared/cowork/constants';
import { OpenClawBridgeIpc } from '../../shared/ipc/channels';
import type { PermissionResult } from '../libs/agentEngine';
import type { AskUserResponse, McpBridgeServer } from '../libs/mcpBridgeServer';

export interface OpenClawBridgeIpcDependencies {
  getMcpBridgeServer: () => McpBridgeServer | null;
}

const toAskUserResponse = (result: PermissionResult): AskUserResponse => ({
  behavior: result.behavior,
  answers:
    result.behavior === CoworkPermissionBehavior.Allow && result.updatedInput
      ? (result.updatedInput.answers as Record<string, string> | undefined)
      : undefined,
});

export const registerOpenClawBridgeIpcHandlers = (
  dependencies: OpenClawBridgeIpcDependencies,
): void => {
  ipcMain.handle(
    OpenClawBridgeIpc.RespondAskUser,
    async (
      _event,
      options: {
        requestId: string;
        result: PermissionResult;
      },
    ) => {
      try {
        const bridgeServer = dependencies.getMcpBridgeServer();
        if (!bridgeServer) {
          return { success: false, error: 'OpenClaw bridge server is not available' };
        }

        bridgeServer.resolveAskUser(options.requestId, toAskUserResponse(options.result));
        return { success: true };
      } catch (error) {
        console.error('[OpenClawBridge] failed to respond to an AskUser request:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to respond to AskUser request',
        };
      }
    },
  );
};
