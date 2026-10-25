import { MemoryLifecycleStatus, MemorySourceKind } from '../memory/constants';
import type { ManagedMemoryRecord } from '../memory/types';

export function companionMemoryNeedsReview(record: ManagedMemoryRecord): boolean {
  return (
    record.memoryId === null &&
    record.status === MemoryLifecycleStatus.NeedsReview &&
    record.sourceKind === MemorySourceKind.TaskVerifier &&
    record.deliveryStatus === null
  );
}
