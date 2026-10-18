import {
  type ManualMemoryCreateInput,
  type ManualMemoryUpdateInput,
  type ManagedMemoryListInput,
  type MemoryIpcResult,
  type MemorySessionTitle,
  type MemorySessionTitleResolveInput,
} from '../../shared/memory';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { memoryContract } from '../../shared/ipc/memoryContract';
import type { ProjectMemoryService } from './projectMemoryService';

export function registerMemoryIpcHandlers(options: {
  getService: () => ProjectMemoryService;
  resolveSessionTitles: (sessionIds: readonly string[]) => MemorySessionTitle[];
}): void {
  const handle = async <T>(operation: () => T | Promise<T>): Promise<MemoryIpcResult<T>> => {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  handleIpcContract(memoryContract, {
    list: (_event, input?: ManagedMemoryListInput) =>
      handle(() => options.getService().listManagedMemories(input)),
    resolveSessionTitles: (_event, input?: MemorySessionTitleResolveInput) =>
      handle(() =>
        options.resolveSessionTitles(
          Array.isArray(input?.sessionIds)
            ? input.sessionIds.filter(
                (sessionId): sessionId is string => typeof sessionId === 'string',
              )
            : [],
        ),
      ),
    createManual: (_event, input: ManualMemoryCreateInput) =>
      handle(() => options.getService().createManualMemory(input)),
    updateManual: (_event, input: ManualMemoryUpdateInput) =>
      handle(() => options.getService().updateManualMemory(input)),
    confirmCandidate: (_event, id: string) =>
      handle(() => options.getService().confirmPersonalCandidate(id)),
    archive: (_event, id: string) => handle(() => options.getService().archiveMemory(id)),
    restore: (_event, id: string) => handle(() => options.getService().restoreMemory(id)),
    forget: (_event, id: string, hardDelete: boolean) =>
      handle(() => options.getService().forgetMemory(id, hardDelete)),
    drainOutbox: () => handle(() => options.getService().retryPendingOutbox()),
  });
}
