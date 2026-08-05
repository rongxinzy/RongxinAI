import { ipcMain } from 'electron';

import {
  MemoryIpcChannel,
  type ManagedMemoryListInput,
  type MemoryIpcResult,
} from '../../shared/memory';
import type { ProjectMemoryService } from './projectMemoryService';

export function registerMemoryIpcHandlers(options: {
  getService: () => ProjectMemoryService;
}): void {
  const handle = async <T>(operation: () => T | Promise<T>): Promise<MemoryIpcResult<T>> => {
    try {
      return { success: true, data: await operation() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  ipcMain.handle(MemoryIpcChannel.List, (_event, input?: ManagedMemoryListInput) =>
    handle(() => options.getService().listManagedMemories(input)),
  );
  ipcMain.handle(MemoryIpcChannel.ConfirmCandidate, (_event, id: string) =>
    handle(() => options.getService().confirmPersonalCandidate(id)),
  );
  ipcMain.handle(MemoryIpcChannel.Archive, (_event, id: string) =>
    handle(() => options.getService().archiveMemory(id)),
  );
  ipcMain.handle(MemoryIpcChannel.Restore, (_event, id: string) =>
    handle(() => options.getService().restoreMemory(id)),
  );
  ipcMain.handle(MemoryIpcChannel.Forget, (_event, id: string, hardDelete: boolean) =>
    handle(() => options.getService().forgetMemory(id, hardDelete)),
  );
  ipcMain.handle(MemoryIpcChannel.DrainOutbox, () =>
    handle(() => options.getService().retryPendingOutbox()),
  );
}
