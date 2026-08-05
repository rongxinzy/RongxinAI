import type {
  ManagedMemoryListInput,
  ManagedMemoryRecord,
  MemoryIpcResult,
} from '../../shared/memory';

function unwrap<T>(result: MemoryIpcResult<T>): T {
  if (!result.success) throw new Error(result.error ?? 'Memory operation failed.');
  return result.data as T;
}

export const memoryService = {
  async list(input: ManagedMemoryListInput = {}): Promise<ManagedMemoryRecord[]> {
    return unwrap(await window.electron.memory.list(input));
  },
  async confirmCandidate(id: string): Promise<number | null> {
    return unwrap(await window.electron.memory.confirmCandidate(id));
  },
  async archive(id: string): Promise<void> {
    unwrap(await window.electron.memory.archive(id));
  },
  async restore(id: string): Promise<void> {
    unwrap(await window.electron.memory.restore(id));
  },
  async forget(id: string, hardDelete: boolean): Promise<boolean> {
    return unwrap(await window.electron.memory.forget(id, hardDelete));
  },
  async retryPending(): Promise<number> {
    return unwrap(await window.electron.memory.drainOutbox());
  },
};
