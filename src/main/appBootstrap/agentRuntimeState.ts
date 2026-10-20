import type { AgentManager } from '../agentManager';
import type { CodingRoomService } from '../codingAgent/codingRoomService';
import type { WorkbenchTaskService } from '../workbenchTask/taskService';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import type { SkillManager } from '../skillManager';

/**
 * Session/agent services carved out of the shared `rt` locator (work package
 * I.1): the Pi runtime adapter (the single execution kernel), the workbench
 * task and coding room services layered on it, the skill manager, the agent
 * manager, and the one-shot forwarder binding flag. Initialized lazily by
 * the owning bootstrap module.
 */
export interface AgentRuntimeState {
  piRuntimeAdapter: PiRuntimeAdapter | null;
  workbenchTaskService: WorkbenchTaskService | null;
  codingRoomService: CodingRoomService | null;
  skillManager: SkillManager | null;
  agentManager: AgentManager | null;
  piWorkbenchRuntimeForwarderBound: boolean;
}

export const agentRuntime: AgentRuntimeState = {
  piRuntimeAdapter: null,
  workbenchTaskService: null,
  codingRoomService: null,
  skillManager: null,
  agentManager: null,
  piWorkbenchRuntimeForwarderBound: false,
};
