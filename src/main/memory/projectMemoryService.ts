import { randomUUID } from 'crypto';
import { createManualMemory, updateManualMemory } from './manualMemoryOperations';

import {
  COMPANION_MEMORY_PROJECT_PREFIX,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
  PERSONAL_MEMORY_PROJECT_ID,
  type ManualMemoryCreateInput,
  type ManualMemoryUpdateInput,
  type ManagedMemoryListInput,
  type ManagedMemoryRecord,
  type MemoryKind as MemoryKindValue,
  type MemorySensitivity as MemorySensitivityValue,
  type MemorySourceKind as MemorySourceKindValue,
} from '../../shared/memory';
import {
  MemoryOutboxOperation,
  PERSONAL_MEMORY_SESSION_PREFIX,
  SESSION_SUMMARY_TTL_DAYS,
} from './constants';
import {
  assertCanPromote,
  assertCanSupersede,
  type MemoryRelationshipIdentity,
} from './memoryRelationshipRules';
import {
  resolveReferencedMemoryLink,
  validateMemoryCandidateRelationships,
} from './memoryRelationshipResolution';
import { MemoryReadService, type SessionMemoryIdentityResolver } from './memoryReadService';
import { processMemoryOutboxItem } from './memoryOutboxProcessor';
import type { ProjectIdentity } from './projectIdentity';
import type { MemoryMigrationRecord, MemoryOutboxItem } from './repository';
import { MemoryRepository } from './repository';
import type { ZhiYuanEngramAdapter } from './zhiyuanEngramAdapter';
import { redactPrivateBlocks } from './zhiyuanEngramAdapter';

export interface ActiveSessionSummary {
  content: string;
  metadata: Record<string, unknown>;
}

export class ProjectMemoryService {
  private readonly reads: MemoryReadService;
  constructor(
    readonly repository: MemoryRepository,
    private readonly adapter: ZhiYuanEngramAdapter,
    private readonly resolveIdentity: (cwd: string) => ProjectIdentity,
    private readonly personalDirectory: string,
    private readonly resolveSessionIdentity?: SessionMemoryIdentityResolver,
  ) {
    this.reads = new MemoryReadService(repository, adapter, (cwd, sessionId) =>
      this.memoryIdentity(cwd, sessionId),
    );
  }

  private memoryIdentity(cwd: string, sessionId?: string) {
    return (
      (sessionId ? this.resolveSessionIdentity?.(sessionId) : null) ?? {
        project: this.resolveIdentity(cwd),
        scope: MemoryScope.Project,
      }
    );
  }

  getProjectIdentity(workingDirectory: string): ProjectIdentity {
    return this.resolveIdentity(workingDirectory);
  }

  getSessionMemoryScope(
    sessionId: string,
  ): typeof MemoryScope.Project | typeof MemoryScope.Companion {
    return this.resolveSessionIdentity?.(sessionId)?.scope ?? MemoryScope.Project;
  }

  createManualMemory(input: ManualMemoryCreateInput): Promise<ManagedMemoryRecord> {
    return createManualMemory(this.manualOperations(), input);
  }

  updateManualMemory(input: ManualMemoryUpdateInput): Promise<ManagedMemoryRecord> {
    return updateManualMemory(this.manualOperations(), input);
  }

  private manualOperations() {
    return {
      repository: this.repository,
      resolveIdentity: this.resolveIdentity,
      personalDirectory: this.personalDirectory,
      confirm: (id: string) => this.confirmMemoryCandidate(id),
    };
  }

  recallProject(input: Parameters<MemoryReadService['recallProject']>[0]) {
    return this.reads.recallProject(input);
  }

  recallPersonal(input: Parameters<MemoryReadService['recallPersonal']>[0]) {
    return this.reads.recallPersonal(input);
  }

  recallSession(input: Parameters<MemoryReadService['recallSession']>[0]) {
    return this.reads.recallSession(input);
  }

  listRecallableMemories(input: Parameters<MemoryReadService['listRecallableMemories']>[0]) {
    return this.reads.listRecallableMemories(input);
  }

  getRecallableMemoryById(input: Parameters<MemoryReadService['getRecallableMemoryById']>[0]) {
    return this.reads.getRecallableMemoryById(input);
  }

  buildProjectContext(input: Parameters<MemoryReadService['buildProjectContext']>[0]) {
    return this.reads.buildProjectContext(input);
  }

  async saveProjectMemory(input: {
    sessionId: string;
    workingDirectory: string;
    type: MemoryKindValue;
    title: string;
    content: string;
    topicKey?: string;
    sourceKind?: MemorySourceKindValue;
    importance?: number;
    confidence?: number;
    sensitivity?: MemorySensitivityValue;
    metadata?: Record<string, unknown>;
    supersedesLinkId?: string;
  }): Promise<number | null> {
    const { project, scope } = this.memoryIdentity(input.workingDirectory, input.sessionId);
    const superseded = input.supersedesLinkId
      ? this.resolveReferencedLink('Superseded memory', input.supersedesLinkId, undefined)
      : null;
    if (superseded) {
      assertCanSupersede({ scope, projectId: project.id, sessionId: input.sessionId }, superseded);
    }
    const linkId = randomUUID();
    if (scope === MemoryScope.Companion) {
      // Keep private task writes visible while offline and withdrawable during
      // the remote write, just like memories explicitly added in the companion UI.
      this.repository.createPersonalCandidate({
        ...input,
        id: linkId,
        projectId: project.id,
        projectRoot: project.root,
        scope,
        kind: input.type,
        sourceKind: input.sourceKind ?? MemorySourceKind.Explicit,
        supersedesLinkId: superseded?.id,
      });
      return await this.confirmMemoryCandidate(linkId);
    }
    const outboxId = this.repository.enqueue(
      superseded ? MemoryOutboxOperation.Supersede : MemoryOutboxOperation.Confirm,
      {
        sessionId: input.sessionId,
        projectId: project.id,
        projectRoot: project.root,
        type: input.type,
        title: input.title,
        content: input.content,
        topicKey: input.topicKey,
        sourceKind: input.sourceKind ?? MemorySourceKind.Explicit,
        scope,
        linkId,
        importance: input.importance,
        confidence: input.confidence,
        sensitivity: input.sensitivity,
        metadata: input.metadata,
        supersedesLinkId: superseded?.id,
        supersededObservationId: superseded?.memoryId ?? undefined,
      },
      linkId,
    );
    return await this.processOutboxItem(this.findPending(outboxId));
  }

  proposePersonalMemory(input: {
    sessionId: string;
    workingDirectory: string;
    type: MemoryKindValue;
    title: string;
    content: string;
    topicKey?: string;
    sourceKind?: MemorySourceKindValue;
    importance?: number;
    confidence?: number;
    sensitivity?: MemorySensitivityValue;
    expiresAt?: string;
    taskId?: string;
    runId?: string;
    artifactId?: string;
    approvalId?: string;
    supersedesLinkId?: string;
    supersedesMemoryId?: number;
    promotesLinkId?: string;
    promotesMemoryId?: number;
    metadata?: Record<string, unknown>;
  }): string {
    const { project: workspace } = this.memoryIdentity(input.workingDirectory, input.sessionId);
    const candidateIdentity: MemoryRelationshipIdentity = {
      scope: MemoryScope.Personal,
      projectId: PERSONAL_MEMORY_PROJECT_ID,
      sessionId: input.sessionId,
    };
    const superseded = this.resolveReferencedLink(
      'Superseded memory',
      input.supersedesLinkId,
      input.supersedesMemoryId,
    );
    if (superseded) assertCanSupersede(candidateIdentity, superseded);
    const promotedFrom =
      !input.promotesLinkId && input.promotesMemoryId === undefined
        ? null
        : this.resolveReferencedLink(
            'Promotion source',
            input.promotesLinkId,
            input.promotesMemoryId,
          );
    if (promotedFrom) assertCanPromote(candidateIdentity, promotedFrom, workspace.id);
    return this.repository.createPersonalCandidate({
      ...input,
      projectId: PERSONAL_MEMORY_PROJECT_ID,
      projectRoot: this.personalDirectory,
      scope: MemoryScope.Personal,
      kind: input.type,
      title: redactPrivateBlocks(input.title),
      content: redactPrivateBlocks(input.content),
      sourceKind: input.sourceKind ?? MemorySourceKind.ModelProposal,
      sensitivity: input.sensitivity ?? MemorySensitivity.Normal,
      supersedesLinkId: superseded?.id,
      promotedFromLinkId: promotedFrom?.id,
      promotionSourceProjectId: promotedFrom?.projectId,
      promotionSourceSessionId:
        promotedFrom?.scope === MemoryScope.Session ? promotedFrom.sessionId : undefined,
    });
  }

  proposeProjectMemoryCandidate(input: {
    sessionId: string;
    workingDirectory: string;
    type: MemoryKindValue;
    title: string;
    content: string;
    topicKey?: string;
    importance?: number;
    confidence?: number;
    sensitivity?: MemorySensitivityValue;
    taskId: string;
    runId: string;
    artifactId?: string;
    approvalId?: string;
    metadata?: Record<string, unknown>;
  }): string {
    const { project, scope } = this.memoryIdentity(input.workingDirectory, input.sessionId);
    return this.repository.createPersonalCandidate({
      ...input,
      projectId: project.id,
      projectRoot: project.root,
      scope,
      kind: input.type,
      title: redactPrivateBlocks(input.title),
      content: redactPrivateBlocks(input.content),
      sourceKind: MemorySourceKind.TaskVerifier,
    });
  }

  async confirmPersonalCandidate(id: string): Promise<number | null> {
    return await this.confirmMemoryCandidate(id);
  }

  async confirmMemoryCandidate(id: string): Promise<number | null> {
    const candidate = this.repository.getCandidate(id);
    if (!candidate || candidate.status !== MemoryLifecycleStatus.NeedsReview) {
      throw new Error('Memory candidate is not available for review.');
    }
    const rawCandidate = this.repository.getCandidateDetails(id);
    if (!rawCandidate) throw new Error('Memory candidate details are unavailable.');
    const { superseded, promotedFrom } = validateMemoryCandidateRelationships(
      this.repository,
      candidate,
      rawCandidate,
    );
    const operation = superseded ? MemoryOutboxOperation.Supersede : MemoryOutboxOperation.Confirm;
    const outboxId = this.repository.enqueue(
      operation,
      {
        sessionId:
          candidate.scope === MemoryScope.Personal
            ? `${PERSONAL_MEMORY_SESSION_PREFIX}${candidate.sessionId}`
            : candidate.sessionId,
        projectId: candidate.projectId,
        projectRoot: rawCandidate?.projectRoot || this.personalDirectory,
        type: candidate.kind,
        title: candidate.title,
        content: candidate.content,
        topicKey: candidate.topicKey ?? undefined,
        sourceKind: candidate.sourceKind,
        scope: candidate.scope,
        linkId: candidate.id,
        taskId: candidate.taskId ?? undefined,
        runId: candidate.runId ?? undefined,
        artifactId: candidate.artifactId ?? undefined,
        approvalId: candidate.approvalId ?? undefined,
        importance: candidate.importance,
        confidence: candidate.confidence,
        sensitivity: candidate.sensitivity,
        expiresAt: candidate.expiresAt ?? undefined,
        supersedesLinkId: superseded?.id,
        supersededObservationId: superseded?.memoryId ?? undefined,
        promotedFromLinkId: promotedFrom?.id,
        promotionSourceProjectId: rawCandidate.promotionSourceProjectId ?? undefined,
        promotionSourceSessionId: rawCandidate.promotionSourceSessionId ?? undefined,
        promotionOriginSessionId: promotedFrom ? candidate.sessionId : undefined,
        candidateBacked: true,
        metadata: rawCandidate?.metadata,
      },
      candidate.id,
    );
    return await this.processOutboxItem(this.findPending(outboxId));
  }

  async saveSessionSummary(input: {
    sessionId: string;
    workingDirectory: string;
    summary: string;
    metadata?: Record<string, unknown>;
    linkId?: string;
  }): Promise<number | null> {
    const { project } = this.memoryIdentity(input.workingDirectory, input.sessionId);
    const topicKey = `session/${input.sessionId}`;
    const active = this.repository.findActiveTopic(project.id, MemoryScope.Session, topicKey);
    if (active?.content === input.summary) return active.memoryId;
    const linkId = input.linkId ?? randomUUID();
    const existing = input.linkId ? this.repository.getLink(input.linkId) : null;
    if (existing) return existing.memoryId;
    const pending = input.linkId
      ? this.repository.findPendingByLinkId(input.linkId, MemoryOutboxOperation.SessionSummary)
      : null;
    if (pending) return await this.processOutboxItem(pending);
    const outboxId = this.repository.enqueue(
      MemoryOutboxOperation.SessionSummary,
      {
        sessionId: input.sessionId,
        projectId: project.id,
        projectRoot: project.root,
        type: MemoryKind.SessionSummary,
        title: 'Session summary',
        content: input.summary,
        topicKey,
        sourceKind: MemorySourceKind.SessionSummary,
        scope: MemoryScope.Session,
        linkId,
        metadata: input.metadata,
        expiresAt: new Date(
          Date.now() + SESSION_SUMMARY_TTL_DAYS * 24 * 60 * 60 * 1_000,
        ).toISOString(),
      },
      linkId,
    );
    return await this.processOutboxItem(this.findPending(outboxId));
  }

  getActiveSessionSummary(input: {
    sessionId: string;
    workingDirectory: string;
  }): ActiveSessionSummary | null {
    const { project } = this.memoryIdentity(input.workingDirectory, input.sessionId);
    const active = this.repository.findActiveTopic(
      project.id,
      MemoryScope.Session,
      `session/${input.sessionId}`,
    );
    return active
      ? { content: active.content, metadata: this.repository.getLinkMetadata(active.id) }
      : null;
  }

  listSessionSummaryBackfillRecords(): MemoryMigrationRecord[] {
    // Global backfill can use another session's model. Never send a companion's
    // private transcript through that shared maintenance pass.
    return this.repository
      .listSessionSummaryBackfillRecords()
      .filter(record => !record.memory.projectId.startsWith(COMPANION_MEMORY_PROJECT_PREFIX));
  }

  updateMigrationRecordMetadata(
    record: Pick<MemoryMigrationRecord, 'storageKind'> & { memory: { id: string } },
    metadata: Record<string, unknown>,
  ): void {
    this.repository.updateMigrationRecordMetadata(record.memory.id, record.storageKind, metadata);
  }

  listManagedMemories(input: ManagedMemoryListInput = {}): ManagedMemoryRecord[] {
    const workingDirectory = input.workingDirectory?.trim();
    if (!workingDirectory)
      return this.repository
        .listManaged(input)
        .filter(
          memory =>
            memory.scope !== MemoryScope.Companion &&
            !memory.projectId.startsWith(COMPANION_MEMORY_PROJECT_PREFIX),
        );

    const projectId = this.resolveIdentity(workingDirectory).id;
    const records = this.repository.listManaged({
      ...input,
      projectIds: [projectId, PERSONAL_MEMORY_PROJECT_ID],
    });
    return records.filter(
      memory =>
        (memory.scope === MemoryScope.Personal &&
          memory.projectId === PERSONAL_MEMORY_PROJECT_ID) ||
        ((memory.scope === MemoryScope.Project || memory.scope === MemoryScope.Session) &&
          memory.projectId === projectId),
    );
  }

  archiveMemory(id: string): void {
    const link = this.repository.getLink(id);
    if (!link) throw new Error('Memory not found.');
    this.repository.setLinkStatus(id, MemoryLifecycleStatus.Archived);
  }

  restoreMemory(id: string): void {
    this.repository.restoreLink(id);
  }

  async forgetMemory(id: string, hardDelete: boolean): Promise<boolean> {
    const candidate = this.repository.getCandidate(id);
    if (candidate) {
      if (
        candidate.sourceKind === MemorySourceKind.LegacyFileImport ||
        candidate.sourceKind === MemorySourceKind.LegacySqliteImport
      ) {
        this.repository.rejectCandidate(id);
      } else {
        this.repository.deleteCandidate(id);
      }
      return true;
    }
    const link = this.repository.getLink(id);
    if (!link?.memoryId) throw new Error('Memory not found.');
    if (
      link.sourceKind === MemorySourceKind.LegacyFileImport ||
      link.sourceKind === MemorySourceKind.LegacySqliteImport
    ) {
      this.repository.recordImportRejection(id);
    }
    this.repository.setLinkStatus(id, MemoryLifecycleStatus.Deleted);
    const outboxId = this.repository.enqueue(
      MemoryOutboxOperation.Forget,
      { linkId: id, observationId: link.memoryId, hardDelete },
      id,
    );
    return (await this.processOutboxItem(this.findPending(outboxId))) !== null;
  }

  async drainOutbox(limit = 20): Promise<number> {
    let completed = 0;
    for (const item of this.repository.listPending(limit)) {
      if ((await this.processOutboxItem(item)) !== null) completed += 1;
    }
    return completed;
  }

  async retryPendingOutbox(limit = 20): Promise<number> {
    this.repository.makePendingAvailable();
    return await this.drainOutbox(limit);
  }

  private findPending(id: string): MemoryOutboxItem | null {
    return this.repository.listPending().find(item => item.id === id) ?? null;
  }

  private resolveReferencedLink(
    label: string,
    linkId: string | undefined,
    memoryId: number | undefined,
  ): ManagedMemoryRecord | null {
    return resolveReferencedMemoryLink(this.repository, label, linkId, memoryId);
  }

  private async processOutboxItem(item: MemoryOutboxItem | null): Promise<number | null> {
    return await processMemoryOutboxItem(this.repository, this.adapter, item);
  }
}

export { buildProjectMemoryContextSafe } from './memoryContext';
