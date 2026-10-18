import type { IpcContractApi } from '../../shared/ipc/contract';
import { skillsContractChannels } from '../../shared/ipc/skillsContract.channels';
import { mcpContractChannels } from '../../shared/ipc/mcpContract.channels';
import { marketplaceContractChannels } from '../../shared/marketplace/contract.channels';
import { McpIpc, SkillsIpc } from '../../shared/ipc/channels';
import { onPush, onPushVoid } from './pushChannel';
import { createIpcInvokers } from './createIpcInvokers';

// Skills, MCP servers, and the shared marketplace bridge. Invoke methods come
// from the contract channel maps via createIpcInvokers; push subscriptions
// (onChanged / onBridgeSync*) stay hand-wired below.
export const skillsAndMcpApi = {
  skills: {
    ...createIpcInvokers(skillsContractChannels),
    onChanged: (callback: () => void) => onPushVoid(SkillsIpc.Changed, callback),
  } as IpcContractApi<typeof import('../../shared/ipc/skillsContract').skillsContract> & {
    onChanged: (callback: () => void) => () => void;
  },

  mcp: {
    ...createIpcInvokers(mcpContractChannels),
    onBridgeSyncStart: (callback: () => void) => onPushVoid(McpIpc.BridgeSyncStart, callback),
    onBridgeSyncDone: (callback: (data: { tools: number; error?: string }) => void) =>
      onPush(McpIpc.BridgeSyncDone, callback),
  } as IpcContractApi<typeof import('../../shared/ipc/mcpContract').mcpContract> & {
    onBridgeSyncStart: (callback: () => void) => () => void;
    onBridgeSyncDone: (callback: (data: { tools: number; error?: string }) => void) => () => void;
  },

  marketplace: createIpcInvokers(marketplaceContractChannels) as IpcContractApi<
    typeof import('../../shared/marketplace/contract').marketplaceContract
  >,
};
