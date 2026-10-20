import type { EngramManager } from '../memory/engramManager';
import type { ProjectMemoryService } from '../memory/projectMemoryService';
import type { MemoryRepository } from '../memory/repository';
import type { ZhiYuanEngramAdapter } from '../memory/zhiyuanEngramAdapter';
import type { TodoReminderScheduler } from '../todo/reminderScheduler';

/**
 * Memory domain state carved out of the shared `rt` locator (work package
 * I.1): the local Engram runtime, its SQLite projection adapter, the
 * memory repository and project-memory service, and the todo reminder
 * scheduler. Initialized lazily by the owning bootstrap module.
 */
export interface MemoryRuntimeState {
  engramManager: EngramManager | null;
  engramAdapter: ZhiYuanEngramAdapter | null;
  memoryRepository: MemoryRepository | null;
  projectMemoryService: ProjectMemoryService | null;
  todoReminderScheduler: TodoReminderScheduler | null;
}

export const memoryRuntime: MemoryRuntimeState = {
  engramManager: null,
  engramAdapter: null,
  memoryRepository: null,
  projectMemoryService: null,
  todoReminderScheduler: null,
};
