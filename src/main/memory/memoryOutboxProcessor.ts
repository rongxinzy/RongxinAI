import { MemoryLifecycleStatus } from '../../shared/memory';
import { MemoryOutboxOperation } from './constants';
import { parseConfirmPayload, parseForgetPayload } from './memoryOutboxPayloads';
import { validateMemoryOutboxRelationships } from './memoryRelationshipResolution';
import type { MemoryOutboxItem, MemoryRepository } from './repository';
import type { ZhiYuanEngramAdapter } from './zhiyuanEngramAdapter';

export async function processMemoryOutboxItem(
  repository: MemoryRepository,
  adapter: ZhiYuanEngramAdapter,
  item: MemoryOutboxItem | null,
): Promise<number | null> {
  if (!item) return null;
  if (item.operation === MemoryOutboxOperation.Forget) {
    return await processMemoryForget(repository, adapter, item);
  }
  if (
    item.operation !== MemoryOutboxOperation.Confirm &&
    item.operation !== MemoryOutboxOperation.SessionSummary &&
    item.operation !== MemoryOutboxOperation.Supersede
  ) {
    return null;
  }
  const payload = parseConfirmPayload(item.payload);
  if (!payload) return retryInvalidOutboxItem(repository, item);
  const checkpointSequence =
    typeof payload.metadata?.checkpointSequence === 'number'
      ? payload.metadata.checkpointSequence
      : null;
  if (
    item.operation === MemoryOutboxOperation.SessionSummary &&
    checkpointSequence !== null &&
    repository.maxSessionCheckpointSequence(payload.sessionId) > checkpointSequence
  ) {
    // A newer checkpoint already landed. Retrying this older one would roll
    // the session back, so it is complete by definition rather than an error.
    repository.markCompleted(item.id);
    return null;
  }
  try {
    const { superseded } = validateMemoryOutboxRelationships(repository, payload);
    const candidate = adapter.saveCandidate({
      sessionId: payload.sessionId,
      project: payload.projectId,
      scope: payload.scope,
      type: payload.type,
      title: payload.title,
      content: payload.content,
      topicKey: payload.topicKey,
    });
    const memoryId =
      item.operation === MemoryOutboxOperation.Supersede && payload.supersededObservationId
        ? await adapter.supersede({
            observationId: payload.supersededObservationId,
            replacementCandidateId: candidate.id,
            workingDirectory: payload.projectRoot,
          })
        : await adapter.confirmMemory(candidate.id, payload.projectRoot);
    if (memoryId === null) {
      adapter.discardCandidate(candidate.id);
      repository.markRetry(item.id, item.attempts + 1, 'Memory runtime unavailable.');
      return null;
    }
    repository.createLink({
      id: payload.linkId,
      memoryId,
      projectId: payload.projectId,
      scope: payload.scope,
      sessionId: payload.sessionId,
      sourceKind: payload.sourceKind,
      taskId: payload.taskId,
      runId: payload.runId,
      artifactId: payload.artifactId,
      approvalId: payload.approvalId,
      title: payload.title,
      content: payload.content,
      kind: payload.type,
      topicKey: payload.topicKey,
      importance: payload.importance,
      confidence: payload.confidence,
      sensitivity: payload.sensitivity,
      expiresAt: payload.expiresAt,
      promotedFromLinkId: payload.promotedFromLinkId,
      promotionSourceProjectId: payload.promotionSourceProjectId,
      promotionSourceSessionId: payload.promotionSourceSessionId,
      metadata: payload.metadata,
    });
    if (superseded) {
      repository.setLinkStatus(superseded.id, MemoryLifecycleStatus.Superseded, payload.linkId);
    }
    if (payload.topicKey) {
      repository.supersedeActiveTopic(
        payload.projectId,
        payload.scope,
        payload.topicKey,
        payload.linkId,
      );
    }
    if (payload.candidateBacked) repository.deleteCandidate(payload.linkId);
    repository.markCompleted(item.id);
    return memoryId;
  } catch (error) {
    repository.markRetry(
      item.id,
      item.attempts + 1,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

async function processMemoryForget(
  repository: MemoryRepository,
  adapter: ZhiYuanEngramAdapter,
  item: MemoryOutboxItem,
): Promise<number | null> {
  const payload = parseForgetPayload(item.payload);
  if (!payload) return retryInvalidOutboxItem(repository, item);
  let owner = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
  if (!owner) {
    // Payloads persisted before owner assertions existed recover the owner
    // from the still-persisted link, after checking it names the same target.
    const link = repository.getLink(payload.linkId);
    if (link && link.memoryId === payload.observationId) owner = link.projectId ?? '';
  }
  if (!owner) {
    repository.markRetry(
      item.id,
      item.attempts + 1,
      `Cannot resolve a trusted project owner for forget of link ${payload.linkId}.`,
    );
    return null;
  }
  try {
    const forgotten = await adapter.forget(payload.observationId, payload.hardDelete, owner);
    if (!forgotten) {
      repository.markRetry(item.id, item.attempts + 1, 'Memory runtime unavailable.');
      return null;
    }
    repository.markCompleted(item.id);
    if (payload.hardDelete) repository.deleteLink(payload.linkId);
    return payload.observationId;
  } catch (error) {
    repository.markRetry(
      item.id,
      item.attempts + 1,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

function retryInvalidOutboxItem(repository: MemoryRepository, item: MemoryOutboxItem): null {
  repository.markRetry(item.id, item.attempts + 1, 'Invalid memory outbox payload.');
  return null;
}
