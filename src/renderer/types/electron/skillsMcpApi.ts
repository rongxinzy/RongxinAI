/**
 * Skills and MCP preload surface, split from `../electron.d.ts`.
 *
 * Method signatures and data types derive from the zod IPC contracts
 * (`src/shared/ipc/skillsContract.ts`, `src/shared/ipc/mcpContract.ts`) — the
 * contracts are the single source of truth shared with main and preload.
 */

import type { IpcContractApi } from '../../../shared/ipc/contract';
import type {
  skillsContract,
  SkillsContractTypes,
} from '../../../shared/ipc/skillsContract';
import type { mcpContract } from '../../../shared/ipc/mcpContract';
import type { McpMarketplaceDataIpc, McpServerConfigIpc } from '../../../shared/ipc/mcpContract';

/** Skill row returned by main's SkillManager (`SkillRecord`). */
export type Skill = SkillsContractTypes['skill'];
/** `mcp:*` result envelope servers list. */
export type McpServerConfigIPC = McpServerConfigIpc;

export type EmailConnectivityTestResult = SkillsContractTypes['emailConnectivityTestResult'];
export type McpMarketplaceData = McpMarketplaceDataIpc;

type SkillsContractApi = IpcContractApi<typeof skillsContract>;

export interface SkillsApi extends Omit<SkillsContractApi, 'onChanged'> {
  onChanged: (callback: () => void) => () => void;
}

type McpContractApi = IpcContractApi<typeof mcpContract>;

export interface McpApi extends Omit<McpContractApi, 'onBridgeSyncStart' | 'onBridgeSyncDone'> {
  onBridgeSyncStart: (callback: () => void) => () => void;
  onBridgeSyncDone: (callback: (data: { tools: number; error?: string }) => void) => () => void;
}
