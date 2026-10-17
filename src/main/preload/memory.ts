import { ipcRenderer } from 'electron';

import { MemoryIpcChannel } from '../../shared/memory';

// Memory search, manual curation, and candidate confirmation.
export const memoryApi = {
  memory: {
    list: (input?: unknown) => ipcRenderer.invoke(MemoryIpcChannel.List, input),
    resolveSessionTitles: (input: unknown) =>
      ipcRenderer.invoke(MemoryIpcChannel.ResolveSessionTitles, input),
    createManual: (input: unknown) => ipcRenderer.invoke(MemoryIpcChannel.CreateManual, input),
    updateManual: (input: unknown) => ipcRenderer.invoke(MemoryIpcChannel.UpdateManual, input),
    confirmCandidate: (id: string) => ipcRenderer.invoke(MemoryIpcChannel.ConfirmCandidate, id),
    archive: (id: string) => ipcRenderer.invoke(MemoryIpcChannel.Archive, id),
    restore: (id: string) => ipcRenderer.invoke(MemoryIpcChannel.Restore, id),
    forget: (id: string, hardDelete: boolean) =>
      ipcRenderer.invoke(MemoryIpcChannel.Forget, id, hardDelete),
    drainOutbox: () => ipcRenderer.invoke(MemoryIpcChannel.DrainOutbox),
  },
};
