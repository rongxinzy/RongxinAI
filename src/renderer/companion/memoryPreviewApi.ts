import {
  MemoryDeliveryStatus,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
  type ManagedMemoryRecord,
} from '../../shared/memory';
import type { CompanionWindowApi } from '../../shared/companion/types';

/** Browser fixture only; private memory persistence is verified against the main-process service. */
export function createCompanionMemoryPreview(
  active: () => string,
): Pick<CompanionWindowApi, 'listMemories' | 'saveMemory' | 'forgetMemory' | 'shareMemory'> {
  const records = new Map<string, Map<string, ManagedMemoryRecord>>();
  const owned = (petId: string) => {
    if (petId !== active()) throw new Error('Companion selection changed.');
    let result = records.get(petId);
    if (!result) {
      result = new Map();
      records.set(petId, result);
    }
    return result;
  };
  let sequence = 0;
  return {
    listMemories: async petId => [...owned(petId).values()],
    saveMemory: async input => {
      const list = owned(input.petId);
      const previous = list.get(input.requestId);
      if (previous) return previous;
      const now = new Date().toISOString();
      const record: ManagedMemoryRecord = {
        id: input.requestId,
        memoryId: ++sequence,
        projectId: input.petId,
        scope: MemoryScope.Companion,
        sessionId: input.petId,
        sourceKind: MemorySourceKind.Explicit,
        taskId: null,
        runId: null,
        artifactId: null,
        approvalId: null,
        status: MemoryLifecycleStatus.Active,
        title: input.title,
        content: input.content,
        kind: input.kind,
        topicKey: null,
        importance: 0.5,
        confidence: 0.5,
        sensitivity: MemorySensitivity.Normal,
        expiresAt: null,
        supersededBy: null,
        promotedFromLinkId: null,
        promotionSourceProjectId: null,
        promotionSourceSessionId: null,
        createdAt: now,
        updatedAt: now,
        deliveryStatus: MemoryDeliveryStatus.Completed,
        deliveryError: null,
      };
      if (input.replacesId) list.delete(input.replacesId);
      list.set(record.id, record);
      return record;
    },
    forgetMemory: async (petId, id) => owned(petId).delete(id),
    shareMemory: async input => {
      if (!input.confirmed || !owned(input.petId).has(input.id))
        throw new Error('Memory not found.');
      return { id: input.requestId, available: true };
    },
  };
}
