import { MemoryOutboxOperation } from './constants';
import {
  parseConfirmPayload,
  parseFinalizeSessionPayload,
  parseForgetPayload,
} from './memoryOutboxPayloads';
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
  if (item.operation === MemoryOutboxOperation.FinalizeSession) {
    return await processSessionFinalization(repository, adapter, item);
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
    payload.topicKey === `session/${payload.sessionId}` &&
    checkpointSequence !== null &&
    repository.maxConfirmedSessionCheckpointSequence(payload.sessionId) > checkpointSequence
  ) {
    repository.markSuperseded(item.id);
    return null;
  }
  try {
    const { superseded } = validateMemoryOutboxRelationships(repository, payload);
    const runtimeSessionId =
      repository.lifecycle?.getRuntimeSessionId(payload.sessionId) ?? undefined;
    const candidate = adapter.saveCandidate({
      sessionId: payload.sessionId,
      project: payload.projectId,
      scope: payload.scope,
      type: payload.type,
      title: payload.title,
      content: payload.content,
      topicKey: payload.topicKey,
      operationId: payload.linkId,
      runtimeSessionId,
      recoverExistingResult: true,
    });
    const onRuntimeSession = (resolvedId: string, recovered = false): void => {
      repository.lifecycle?.saveRuntimeSessionId({
        localSessionId: payload.sessionId,
        runtimeSessionId: resolvedId,
        projectId: payload.projectId,
        projectRoot: payload.projectRoot,
        makeCurrent: !recovered,
      });
    };
    const memoryId =
      item.operation === MemoryOutboxOperation.Supersede && payload.supersededObservationId
        ? await adapter.supersede({
            observationId: payload.supersededObservationId,
            candidate,
            workingDirectory: payload.projectRoot,
            onRuntimeSession,
          })
        : await adapter.confirmMemory(candidate, payload.projectRoot, onRuntimeSession);
    if (memoryId === null) {
      repository.markRetry(item.id, item.attempts + 1, 'Memory runtime unavailable.');
      return null;
    }
    repository.confirmOutboxDelivery({
      outboxId: item.id,
      link: {
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
      },
      topicKey: payload.topicKey,
      candidateBacked: payload.candidateBacked,
      superseded,
    });
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

async function processSessionFinalization(
  repository: MemoryRepository,
  adapter: ZhiYuanEngramAdapter,
  item: MemoryOutboxItem,
): Promise<number | null> {
  const payload = parseFinalizeSessionPayload(item.payload);
  if (!payload) return retryInvalidOutboxItem(repository, item);
  if (repository.lifecycle?.deferSessionFinalization(item.id, payload.sessionId)) return null;
  try {
    const result = await adapter.finalizeSession({
      sessionId: payload.runtimeSessionId,
      project: payload.projectId,
      summary: payload.summary,
    });
    if (!result) {
      repository.markRetry(item.id, item.attempts + 1, 'Memory runtime unavailable.');
      return null;
    }
    repository.lifecycle.completeSessionFinalization(item.id);
    return result.summaryId;
  } catch (error) {
    repository.lifecycle.failSessionFinalization(
      item.id,
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
    if (
      repository.lifecycle?.hasOtherObservationReferences(payload.observationId, payload.linkId)
    ) {
      repository.completeForget({
        outboxId: item.id,
        linkId: payload.linkId,
        hardDelete: payload.hardDelete,
      });
      return payload.observationId;
    }
    const forgotten = await adapter.forget(payload.observationId, payload.hardDelete, owner);
    if (!forgotten) {
      repository.markRetry(item.id, item.attempts + 1, 'Memory runtime unavailable.');
      return null;
    }
    repository.completeForget({
      outboxId: item.id,
      linkId: payload.linkId,
      hardDelete: payload.hardDelete,
    });
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
