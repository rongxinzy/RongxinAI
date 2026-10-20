import type { BrowserWindow } from 'electron';

import type { AgentManager } from '../agentManager';
import type { CodingRoomService } from '../codingAgent/codingRoomService';
import type { AppUpdateCoordinator } from '../libs/appUpdateCoordinator';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import type { SkillManager } from '../skillManager';
import type { WorkbenchTaskService } from '../workbenchTask/taskService';

/**
 * Mutable singleton state shared across the main-process bootstrap modules.
 * Everything here is initialized lazily by the owning module; the object shape
 * keeps cross-module reads/writes identical to the previous single-closure
 * behavior in main.ts.
 */
export const rt = {
  piRuntimeAdapter: null as PiRuntimeAdapter | null,
  workbenchTaskService: null as WorkbenchTaskService | null,
  codingRoomService: null as CodingRoomService | null,

  skillManager: null as SkillManager | null,

  piWorkbenchRuntimeForwarderBound: false,
  preventSleepBlockerId: null as number | null,
  appUpdateCoordinator: null as AppUpdateCoordinator | null,
  appUpdatePollTimer: null as NodeJS.Timeout | null,
  lastSuccessfulAppUpdateCheckAt: 0,

  agentManager: null as AgentManager | null,

  mainWindow: null as BrowserWindow | null,

  isQuitting: false,
  lastReloadAt: 0,
  windowStateSaveTimer: null as ReturnType<typeof setTimeout> | null,
};
