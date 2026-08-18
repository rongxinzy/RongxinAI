import {
  MemoryKind,
  MemoryScope,
  MemorySourceKind,
  type ManagedMemoryRecord,
} from '../../shared/memory';
import {
  WorkbenchApprovalEffectStatus,
  WorkbenchArtifactVerificationStatus,
} from '../../shared/workbenchTask';
import type { CoworkMessage, CoworkStore } from '../coworkStore';
import type { WorkbenchTaskService } from '../workbenchTask/taskService';
import {
  AtomicMemoryExtractor,
  type AtomicMemoryItem,
  type AtomicMemorySource,
} from './atomicMemoryExtractor';
import {
  ATOMIC_MEMORY_EXTRACTOR_VERSION,
  AtomicMemorySourceKind,
  MemoryExtractorKind,
  MemoryRecordStorageKind,
  PERSONAL_MEMORY_SESSION_PREFIX,
  SEMANTIC_MEMORY_MIGRATION_VERSION,
  SemanticMemoryMigrationStatus,
} from './constants';
import type { ProjectMemoryService } from './projectMemoryService';
import type { MemoryMigrationRecord } from './repository';
import {
  buildSessionMemorySource,
  type SessionMemoryCompletion,
} from './sessionMemoryExtractor';

export interface LegacyMemoryMigrationResult {
  migrated: number;
  pendingReview: number;
  removed: number;
  retained: number;
  unavailable: number;
}

interface SemanticMigrationMetadata {
  version: number;
  legacyRecordId: string;
  legacyStorageKind: MemoryMigrationRecord['storageKind'];
}

export class LegacyMemoryMigrationService {
  constructor(
    private readonly memoryService: ProjectMemoryService,
    private readonly coworkStore: CoworkStore,
    private readonly workbenchTaskService: WorkbenchTaskService,
    private readonly extractor = new AtomicMemoryExtractor(),
  ) {}

  async migrateSession(input: {
    sessionId: string;
    workingDirectory: string;
    complete: SessionMemoryCompletion;
  }): Promise<LegacyMemoryMigrationResult> {
    const result: LegacyMemoryMigrationResult = {
      migrated: 0,
      pendingReview: 0,
      removed: 0,
      retained: 0,
      unavailable: 0,
    };
    const records = this.memoryService
      .listMigrationRecordsForContext(input.workingDirectory)
      .filter(record => shouldMigrateRecord(record));
    for (const record of records) {
      try {
        const originSessionId = normalizeOriginSessionId(record.memory.sessionId);
        const originSession = this.coworkStore.getSession(originSessionId, null);
        if (!originSession) {
          this.markLegacyRecord(record, SemanticMemoryMigrationStatus.EvidenceUnavailable);
          result.unavailable += 1;
          continue;
        }
        await this.migrateRecord(
          record,
          originSession.messages,
          {
            sessionId: originSessionId,
            workingDirectory: originSession.cwd,
            complete: input.complete,
          },
          result,
        );
      } catch (error) {
        console.warn(
          `[MemoryMigration] Failed to migrate memory ${record.memory.id} from session ${input.sessionId}:`,
          error,
        );
      }
    }
    return result;
  }

  private async migrateRecord(
    record: MemoryMigrationRecord,
    messages: CoworkMessage[],
    input: {
      sessionId: string;
      workingDirectory: string;
      complete: SessionMemoryCompletion;
    },
    result: LegacyMemoryMigrationResult,
  ): Promise<void> {
    if (record.memory.scope === MemoryScope.Session) return;
    if (
      record.storageKind === MemoryRecordStorageKind.Candidate &&
      record.memory.scope === MemoryScope.Project &&
      (!record.memory.taskId || !record.memory.runId)
    ) {
      this.markLegacyRecord(record, SemanticMemoryMigrationStatus.EvidenceUnavailable);
      result.unavailable += 1;
      return;
    }
    const sources = this.buildCanonicalSources(record, messages);
    if (sources.length === 0) {
      this.markLegacyRecord(record, SemanticMemoryMigrationStatus.EvidenceUnavailable);
      result.unavailable += 1;
      return;
    }
    const extracted = await this.extractor.extract({
      scope: record.memory.scope,
      sources,
      requestedMemory: {
        title: record.memory.title,
        content: record.memory.content,
        kind:
          record.memory.kind === MemoryKind.Preference
            ? MemoryKind.Preference
            : MemoryKind.Decision,
      },
      maxItems: record.memory.sourceKind === MemorySourceKind.TaskVerifier ? 5 : 1,
      complete: input.complete,
    });
    if (!extracted) {
      this.handleNoReplacement(record, result);
      return;
    }
    const replacementIds: string[] = [];
    for (const [index, memory] of extracted.memories.entries()) {
      const metadata = {
        ...extracted.metadataFor(memory),
        semanticMigration: migrationMetadata(record),
      };
      const replacementId = await this.persistReplacement(
        record,
        memory,
        metadata,
        index,
        input,
      );
      replacementIds.push(replacementId);
    }
    if (record.storageKind === MemoryRecordStorageKind.Candidate) {
      this.memoryService.deleteMigrationCandidate(record.memory.id);
      result.migrated += extracted.memories.length;
      return;
    }
    if (record.memory.scope === MemoryScope.Personal) {
      this.markLegacyRecord(record, SemanticMemoryMigrationStatus.PendingReview, {
        replacementCandidateIds: replacementIds,
      });
      result.pendingReview += replacementIds.length;
      return;
    }
    if (replacementIds.some(id => id === SemanticMemoryMigrationStatus.DeliveryPending)) {
      this.markLegacyRecord(record, SemanticMemoryMigrationStatus.DeliveryPending);
    }
    result.migrated += extracted.memories.length;
  }

  private buildCanonicalSources(
    record: MemoryMigrationRecord,
    messages: CoworkMessage[],
  ): AtomicMemorySource[] {
    const cutoff = parseSqliteTimestamp(record.memory.createdAt);
    const conversation = buildSessionMemorySource(
      Number.isFinite(cutoff)
        ? messages.filter(message => message.timestamp <= cutoff + 1_000)
        : messages,
    ).map(message => ({
      id: message.id,
      kind: AtomicMemorySourceKind.Conversation,
      content: message.content,
    }));
    if (!record.memory.taskId) return conversation;
    const detail = this.workbenchTaskService.getDetail(record.memory.taskId);
    const run = detail?.runs.find(candidate => candidate.id === record.memory.runId);
    if (!detail || !run) return conversation;
    const sources: AtomicMemorySource[] = [
      ...conversation,
      {
        id: `task:${detail.task.id}:goal`,
        kind: AtomicMemorySourceKind.TaskGoal,
        content: detail.task.goal,
      },
    ];
    if (run.verificationResult) {
      sources.push({
        id: `run:${run.id}:verification`,
        kind: AtomicMemorySourceKind.Verification,
        content: JSON.stringify(run.verificationResult),
      });
    }
    for (const artifact of detail.artifacts.filter(
      item =>
        item.runId === run.id &&
        item.verificationStatus === WorkbenchArtifactVerificationStatus.Verified,
    )) {
      sources.push({
        id: `artifact:${artifact.id}`,
        kind: AtomicMemorySourceKind.Artifact,
        content: JSON.stringify({
          reference: artifact.reference,
          contentHash: artifact.contentHash,
          provenance: artifact.provenance,
          metadata: artifact.metadata,
        }),
      });
    }
    for (const approval of detail.approvals.filter(
      item =>
        item.runId === run.id && item.effectStatus === WorkbenchApprovalEffectStatus.Succeeded,
    )) {
      sources.push({
        id: `approval:${approval.id}`,
        kind: AtomicMemorySourceKind.Approval,
        content: JSON.stringify({
          toolName: approval.toolName,
          decision: approval.decision,
          effectStatus: approval.effectStatus,
        }),
      });
    }
    return sources;
  }

  private async persistReplacement(
    record: MemoryMigrationRecord,
    memory: AtomicMemoryItem,
    metadata: Record<string, unknown>,
    index: number,
    input: { sessionId: string; workingDirectory: string },
  ): Promise<string> {
    const topicKey = replacementTopicKey(record.memory, index);
    if (record.storageKind === MemoryRecordStorageKind.Candidate) {
      if (record.memory.scope === MemoryScope.Personal) {
        return this.memoryService.proposePersonalMemory({
          sessionId: input.sessionId,
          workingDirectory: input.workingDirectory,
          type: memory.kind,
          title: memory.title,
          content: memory.content,
          topicKey,
          importance: memory.importance,
          confidence: memory.confidence,
          sensitivity: memory.sensitivity,
          supersedesLinkId: record.supersedesLinkId ?? undefined,
          promotesLinkId: record.promotedFromLinkId ?? undefined,
          metadata,
        });
      }
      if (!record.memory.taskId || !record.memory.runId) {
        throw new Error('A legacy Project candidate is missing Task or Run provenance.');
      }
      return this.memoryService.proposeProjectMemoryCandidate({
        sessionId: input.sessionId,
        workingDirectory: input.workingDirectory,
        type: memory.kind,
        title: memory.title,
        content: memory.content,
        topicKey,
        importance: memory.importance,
        confidence: memory.confidence,
        sensitivity: memory.sensitivity,
        taskId: record.memory.taskId,
        runId: record.memory.runId,
        artifactId: evidenceRecordId(memory, 'artifact:'),
        approvalId: evidenceRecordId(memory, 'approval:'),
        metadata,
      });
    }
    if (record.memory.scope === MemoryScope.Personal) {
      return this.memoryService.proposePersonalMemory({
        sessionId: input.sessionId,
        workingDirectory: input.workingDirectory,
        type: memory.kind,
        title: memory.title,
        content: memory.content,
        topicKey,
        importance: memory.importance,
        confidence: memory.confidence,
        sensitivity: memory.sensitivity,
        supersedesLinkId: index === 0 ? record.memory.id : undefined,
        metadata,
      });
    }
    const memoryId = await this.memoryService.saveProjectMemory({
      sessionId: input.sessionId,
      workingDirectory: input.workingDirectory,
      type: memory.kind,
      title: memory.title,
      content: memory.content,
      topicKey,
      importance: memory.importance,
      confidence: memory.confidence,
      sensitivity: memory.sensitivity,
      metadata,
      supersedesLinkId: index === 0 ? record.memory.id : undefined,
    });
    return memoryId === null
      ? SemanticMemoryMigrationStatus.DeliveryPending
      : String(memoryId);
  }

  private handleNoReplacement(
    record: MemoryMigrationRecord,
    result: LegacyMemoryMigrationResult,
  ): void {
    if (record.storageKind === MemoryRecordStorageKind.Candidate) {
      this.memoryService.deleteMigrationCandidate(record.memory.id);
      result.removed += 1;
      return;
    }
    if (record.memory.scope === MemoryScope.Project) {
      this.memoryService.archiveMemory(record.memory.id);
      result.removed += 1;
      return;
    }
    this.markLegacyRecord(record, SemanticMemoryMigrationStatus.RetainedNoReplacement);
    result.retained += 1;
  }

  private markLegacyRecord(
    record: MemoryMigrationRecord,
    status: (typeof SemanticMemoryMigrationStatus)[keyof typeof SemanticMemoryMigrationStatus],
    extra: Record<string, unknown> = {},
  ): void {
    this.memoryService.updateMigrationRecordMetadata(record, {
      ...record.metadata,
      semanticMigration: {
        ...migrationMetadata(record),
        status,
        ...extra,
      },
    });
  }
}

function shouldMigrateRecord(record: MemoryMigrationRecord): boolean {
  if (record.memory.scope === MemoryScope.Session) return false;
  if (isCurrentAtomicMetadata(record.metadata)) return false;
  const migration = record.metadata.semanticMigration;
  return !(
    migration &&
    typeof migration === 'object' &&
    !Array.isArray(migration) &&
    (migration as Record<string, unknown>).version === SEMANTIC_MEMORY_MIGRATION_VERSION
  );
}

function isCurrentAtomicMetadata(metadata: Record<string, unknown>): boolean {
  const candidate =
    metadata.extractorKind === MemoryExtractorKind.Atomic ? metadata : metadata.extraction;
  return Boolean(
    candidate &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).extractorKind === MemoryExtractorKind.Atomic &&
      (candidate as Record<string, unknown>).extractorVersion ===
        ATOMIC_MEMORY_EXTRACTOR_VERSION,
  );
}

function migrationMetadata(record: MemoryMigrationRecord): SemanticMigrationMetadata {
  return {
    version: SEMANTIC_MEMORY_MIGRATION_VERSION,
    legacyRecordId: record.memory.id,
    legacyStorageKind: record.storageKind,
  };
}

function replacementTopicKey(memory: ManagedMemoryRecord, index: number): string {
  const base = memory.topicKey ?? `migration/${memory.id}`;
  return index === 0 && memory.sourceKind !== MemorySourceKind.TaskVerifier
    ? base
    : `${base}/${index + 1}`;
}

function evidenceRecordId(memory: AtomicMemoryItem, prefix: string): string | undefined {
  return memory.evidenceSourceIds.find(id => id.startsWith(prefix))?.slice(prefix.length);
}

function parseSqliteTimestamp(value: string): number {
  if (!value) return Number.NaN;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return Date.parse(normalized);
}

function normalizeOriginSessionId(sessionId: string): string {
  return sessionId.startsWith(PERSONAL_MEMORY_SESSION_PREFIX)
    ? sessionId.slice(PERSONAL_MEMORY_SESSION_PREFIX.length)
    : sessionId;
}
