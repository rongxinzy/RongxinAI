import type { ProjectMemoryService } from '../memory/projectMemoryService';
import type { MemoryRepository } from '../memory/repository';
import type { MarkdownMemoryBackend } from '../memory/markdownMemoryBackend';
import type { TodoReminderScheduler } from '../todo/reminderScheduler';

/**
 * Memory domain state carved out of the shared `rt` locator (work package
 * I.1): the native Markdown memory plugin, the memory repository and
 * project-memory service, and the todo reminder
 * scheduler. Initialized lazily by the owning bootstrap module.
 */
export interface MemoryRuntimeState {
  memoryBackend: MarkdownMemoryBackend | null;
  memoryRepository: MemoryRepository | null;
  projectMemoryService: ProjectMemoryService | null;
  todoReminderScheduler: TodoReminderScheduler | null;
}

export const memoryRuntime: MemoryRuntimeState = {
  memoryBackend: null,
  memoryRepository: null,
  projectMemoryService: null,
  todoReminderScheduler: null,
};
