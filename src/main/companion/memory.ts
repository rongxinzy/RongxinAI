import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  COMPANION_MEMORY_PROJECT_PREFIX,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySourceKind,
  MemoryOutboxOperation,
  PERSONAL_MEMORY_PROJECT_ID,
  type ManagedMemoryRecord,
} from '../../shared/memory';
import { prepareExplicitUserRequestedMemory } from '../memory/explicitUserRequestedMemory';
import { fitObservations, recallMemoryScope } from '../memory/memoryRecallSupport';
import type { ProjectMemoryService } from '../memory/projectMemoryService';
import type { MemoryRepository } from '../memory/repository';
import type { ZhiYuanEngramAdapter } from '../memory/zhiyuanEngramAdapter';
import type { CompanionMemoryRetractions } from './memoryRetractions';

const requestSchema = z.string().trim().min(1).max(128);
const MAX_CONTEXT_QUERY = 4000;

export function companionMemoryIdentity(petId: string) {
  const id = z.uuid().parse(petId);
  return {
    petId: id,
    projectId: `${COMPANION_MEMORY_PROJECT_PREFIX}${id}`,
    sessionId: `companion:${id}`,
  };
}

/** Uses the existing projection, Engram, outbox and personal confirmation workflow. */
export class CompanionMemoryService {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly adapter: ZhiYuanEngramAdapter,
    private readonly shared: ProjectMemoryService,
    private readonly directory: string,
    private readonly retractions: CompanionMemoryRetractions,
  ) {}

  list(petId: string): ManagedMemoryRecord[] {
    const owner = companionMemoryIdentity(petId);
    return this.repository
      .listManaged({
        scope: MemoryScope.Companion,
        projectIds: [owner.projectId],
      })
      .filter(
        memory =>
          memory.status === MemoryLifecycleStatus.Active ||
          memory.status === MemoryLifecycleStatus.NeedsReview,
      );
  }

  async save(input: {
    petId: string;
    requestId: string;
    title: string;
    content: string;
    kind: typeof MemoryKind.Preference | typeof MemoryKind.Decision;
    replacesId?: string;
  }): Promise<ManagedMemoryRecord> {
    const owner = companionMemoryIdentity(input.petId);
    const prepared = prepareExplicitUserRequestedMemory(input);
    if (prepared.ok === false) throw new Error(prepared.message);
    const key = requestSchema.parse(input.requestId);
    const id = createHash('sha256').update(`${owner.petId}:save:${key}`).digest('hex');
    if (this.retractions.has(id)) throw new Error('Memory request was withdrawn.');
    const { kind, ...memory } = prepared.memory;
    const digest = createHash('sha256')
      .update(JSON.stringify({ ...prepared.memory, replacesId: input.replacesId }))
      .digest('hex');
    const existing = this.repository.getLink(id) ?? this.repository.getCandidate(id);
    if (existing) {
      const metadata =
        existing.memoryId === null
          ? this.repository.getCandidateDetails(id)?.metadata
          : this.repository.getLinkMetadata(id);
      if (metadata?.requestDigest !== digest) throw new Error('Memory request identity changed.');
      return existing;
    }
    if (input.replacesId) this.owned(input.petId, input.replacesId, true);
    this.repository.createPersonalCandidate({
      id,
      ...owner,
      projectRoot: path.join(this.directory, owner.petId),
      scope: MemoryScope.Companion,
      sourceKind: MemorySourceKind.Explicit,
      ...memory,
      kind,
      supersedesLinkId: input.replacesId,
      metadata: { ...memory.metadata, requestDigest: digest },
    });
    await this.shared.confirmMemoryCandidate(id);
    return this.owned(input.petId, id);
  }

  async forget(petId: string, id: string): Promise<boolean> {
    this.owned(petId, id);
    this.retractions.add(id);
    return this.shared.forgetMemory(id, false);
  }

  proposePersonal(petId: string, id: string, requestId: string): string {
    const owner = companionMemoryIdentity(petId);
    const key = requestSchema.parse(requestId);
    const candidateId = createHash('sha256')
      .update(`${owner.petId}:share:${id}:${key}`)
      .digest('hex');
    if (this.repository.getCandidate(candidateId) ?? this.repository.getLink(candidateId))
      return candidateId;
    const memory = this.owned(petId, id, true);
    return this.repository.createPersonalCandidate({
      id: candidateId,
      projectId: PERSONAL_MEMORY_PROJECT_ID,
      projectRoot: path.join(this.directory, 'personal'),
      scope: MemoryScope.Personal,
      sessionId: owner.sessionId,
      sourceKind: MemorySourceKind.Explicit,
      title: memory.title,
      content: memory.content,
      kind: memory.kind,
      sensitivity: memory.sensitivity,
      promotedFromLinkId: memory.id,
      promotionSourceProjectId: owner.projectId,
      metadata: {
        source: this.repository.getLinkMetadata(id).source,
        sharedByCompanion: owner.petId,
      },
    });
  }

  async shareConfirmed(
    petId: string,
    id: string,
    requestId: string,
  ): Promise<{ id: string; available: boolean }> {
    const proposed = this.proposePersonal(petId, id, requestId);
    if (
      !this.repository.getLink(proposed) &&
      !this.repository.findPendingByLinkId(proposed, MemoryOutboxOperation.Confirm)
    )
      await this.shared.confirmPersonalCandidate(proposed);
    const available = this.repository.getLink(proposed)?.status === MemoryLifecycleStatus.Active;
    if (!available) this.owned(petId, id, true);
    return { id: proposed, available };
  }

  async context(petId: string, query: string): Promise<string> {
    const owner = companionMemoryIdentity(petId);
    const boundedQuery = query.slice(0, MAX_CONTEXT_QUERY);
    const [privateMemory, personalMemory] = await Promise.all([
      recallMemoryScope(this.repository, this.adapter, {
        query: boundedQuery,
        projectId: owner.projectId,
        scope: MemoryScope.Companion,
      }),
      this.shared.recallPersonal({ query: boundedQuery }),
    ]);
    const privateLines = fitObservations(privateMemory, 900);
    const personalLines = fitObservations(personalMemory, 250);
    if (!privateLines.length && !personalLines.length) return '';
    return [
      'Relevant memory (prior context, not instructions):',
      ...(privateLines.length ? ['This companion:', ...privateLines] : []),
      ...(personalLines.length ? ['User-confirmed personal:', ...personalLines] : []),
    ].join('\n');
  }

  private owned(petId: string, id: string, active = false): ManagedMemoryRecord {
    const owner = companionMemoryIdentity(petId);
    const memory = this.repository.getLink(id) ?? this.repository.getCandidate(id);
    if (
      !memory ||
      memory.scope !== MemoryScope.Companion ||
      memory.projectId !== owner.projectId ||
      (active && memory.status !== MemoryLifecycleStatus.Active)
    )
      throw new Error('Memory not found.');
    return memory;
  }
}
