import type Database from 'better-sqlite3';

import { MemoryLifecycleStatus, type ManagedMemoryRecord } from '../../shared/memory';
import type { MemoryLinkInput, MemoryRepository } from './repository';

export interface MemoryOutboxConfirmationInput {
  outboxId: string;
  link: MemoryLinkInput;
  topicKey?: string;
  candidateBacked?: boolean;
  superseded: ManagedMemoryRecord | null;
}

export interface MemoryForgetCompletionInput {
  outboxId: string;
  linkId: string;
  hardDelete: boolean;
}

export function commitMemoryOutboxConfirmation(
  db: Database.Database,
  repository: MemoryRepository,
  input: MemoryOutboxConfirmationInput,
): void {
  db.transaction(() => {
    const existing = repository.getLink(input.link.id ?? '');
    if (existing && existing.status !== MemoryLifecycleStatus.Active) {
      repository.markCompleted(input.outboxId);
      return;
    }
    repository.createLink(input.link);
    const superseded = input.superseded ? repository.getLink(input.superseded.id) : null;
    if (superseded?.status === MemoryLifecycleStatus.Active && input.link.id) {
      repository.setLinkStatus(superseded.id, MemoryLifecycleStatus.Superseded, input.link.id);
    }
    if (input.topicKey && input.link.id) {
      repository.supersedeActiveTopic(
        input.link.projectId,
        input.link.scope,
        input.topicKey,
        input.link.id,
      );
    }
    if (input.candidateBacked && input.link.id) repository.deleteCandidate(input.link.id);
    repository.markCompleted(input.outboxId);
  })();
}

export function commitMemoryForgetCompletion(
  db: Database.Database,
  repository: MemoryRepository,
  input: MemoryForgetCompletionInput,
): void {
  db.transaction(() => {
    repository.markCompleted(input.outboxId);
    if (input.hardDelete) repository.deleteLink(input.linkId);
  })();
}
