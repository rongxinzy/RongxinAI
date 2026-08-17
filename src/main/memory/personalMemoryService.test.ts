import { expect, test, vi } from 'vitest';

import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryOutboxOperation,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
  PERSONAL_MEMORY_PROJECT_ID,
  type ManagedMemoryRecord,
} from '../../shared/memory';
import type { ProjectIdentity } from './projectIdentity';
import { ProjectMemoryService } from './projectMemoryService';
import type { MemoryOutboxItem, PersonalMemoryCandidateInput } from './repository';

class PersonalRepositoryFake {
  items: MemoryOutboxItem[] = [];
  candidates = new Map<string, ManagedMemoryRecord>();
  candidateInputs = new Map<string, PersonalMemoryCandidateInput>();
  links = new Map<string, ManagedMemoryRecord>();
  events: string[] = [];

  createPersonalCandidate(input: PersonalMemoryCandidateInput) {
    const id = input.id ?? 'candidate-1';
    this.candidateInputs.set(id, input);
    this.candidates.set(id, recordFor(id, input));
    return id;
  }

  getCandidate(id: string) {
    return this.candidates.get(id) ?? null;
  }

  getCandidateDetails(id: string) {
    const input = this.candidateInputs.get(id);
    return {
      supersedesLinkId: input?.supersedesLinkId ?? null,
      projectRoot: input?.projectRoot ?? '',
      metadata: input?.metadata ?? {},
    };
  }

  getLink(id: string) {
    return this.links.get(id) ?? null;
  }

  enqueue(operation: MemoryOutboxOperation, payload: Record<string, unknown>, linkId?: string) {
    const id = `outbox-${this.items.length + 1}`;
    this.items.push({
      id,
      linkId: linkId ?? null,
      operation,
      payload,
      status: MemoryDeliveryStatus.Pending,
      attempts: 0,
      availableAt: new Date(0).toISOString(),
      lastError: null,
    });
    this.events.push(`enqueue:${operation}`);
    return id;
  }

  listPending() {
    return this.items.filter(item => item.status === MemoryDeliveryStatus.Pending);
  }

  createLink(input: Record<string, unknown>) {
    const id = String(input.id);
    this.links.set(id, {
      ...this.candidates.get(id)!,
      memoryId: Number(input.memoryId),
      status: MemoryLifecycleStatus.Active,
    });
    this.events.push('link');
    return id;
  }

  deleteCandidate(id: string) {
    this.candidates.delete(id);
  }

  setLinkStatus(id: string, status: ManagedMemoryRecord['status']) {
    const link = this.links.get(id);
    if (link) this.links.set(id, { ...link, status });
    this.events.push(`status:${status}`);
  }

  restoreLink() {}
  deleteLink(id: string) {
    this.links.delete(id);
  }

  markCompleted(id: string) {
    const item = this.items.find(candidate => candidate.id === id);
    if (item) item.status = MemoryDeliveryStatus.Completed;
  }

  markRetry(id: string, attempts: number, error: string) {
    const item = this.items.find(candidate => candidate.id === id);
    if (item) {
      item.attempts = attempts;
      item.lastError = error;
    }
  }

  filterRecallableMemoryIds(input: { memoryIds: number[] }) {
    return new Set(
      input.memoryIds.filter(id => [...this.links.values()].some(link => link.memoryId === id)),
    );
  }
}

function identityFor(cwd: string): ProjectIdentity {
  return { id: cwd, displayName: cwd, root: cwd };
}

function recordFor(id: string, input: PersonalMemoryCandidateInput): ManagedMemoryRecord {
  return {
    id,
    memoryId: null,
    projectId: input.projectId ?? PERSONAL_MEMORY_PROJECT_ID,
    scope: input.scope ?? MemoryScope.Personal,
    sessionId: input.sessionId,
    sourceKind: input.sourceKind,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    artifactId: input.artifactId ?? null,
    approvalId: input.approvalId ?? null,
    status: MemoryLifecycleStatus.NeedsReview,
    title: input.title,
    content: input.content,
    kind: input.kind,
    topicKey: input.topicKey ?? null,
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.5,
    sensitivity: input.sensitivity ?? MemorySensitivity.Normal,
    expiresAt: input.expiresAt ?? null,
    supersededBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    deliveryStatus: null,
    deliveryError: null,
  };
}

test('keeps personal proposals local until the user confirms them', async () => {
  const repository = new PersonalRepositoryFake();
  const adapter = {
    saveCandidate: vi.fn(input => ({ id: 'adapter-candidate', ...input })),
    confirmMemory: vi.fn(async () => 91),
    discardCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(
    repository as never,
    adapter as never,
    identityFor,
    'C:/private/memory',
  );

  const id = service.proposePersonalMemory({
    sessionId: 'session-1',
    type: MemoryKind.Preference,
    title: 'Editor',
    content: 'Prefer compact diffs.',
  });

  expect(adapter.saveCandidate).not.toHaveBeenCalled();
  await expect(service.confirmPersonalCandidate(id)).resolves.toBe(91);
  expect(adapter.saveCandidate).toHaveBeenCalledWith(
    expect.objectContaining({ project: PERSONAL_MEMORY_PROJECT_ID, scope: MemoryScope.Personal }),
  );
  expect(repository.links.get(id)).toMatchObject({ memoryId: 91 });
});

test('marks a memory deleted before attempting remote propagation', async () => {
  const repository = new PersonalRepositoryFake();
  repository.links.set('link-1', {
    ...recordFor('link-1', {
      sessionId: 'session-1',
      sourceKind: MemorySourceKind.Explicit,
      title: 'Preference',
      content: 'Use concise output.',
      kind: MemoryKind.Preference,
    }),
    memoryId: 7,
    status: MemoryLifecycleStatus.Active,
  });
  const service = new ProjectMemoryService(
    repository as never,
    { forget: vi.fn(async () => false) } as never,
    identityFor,
  );

  await expect(service.forgetMemory('link-1', false)).resolves.toBe(false);
  expect(repository.events.slice(0, 2)).toEqual([
    `status:${MemoryLifecycleStatus.Deleted}`,
    `enqueue:${MemoryOutboxOperation.Forget}`,
  ]);
  expect(repository.items[0]).toMatchObject({
    status: MemoryDeliveryStatus.Pending,
    lastError: 'Memory runtime unavailable.',
  });
});

test('keeps verified Task and Run provenance on a project review candidate', async () => {
  const repository = new PersonalRepositoryFake();
  const adapter = {
    saveCandidate: vi.fn(input => ({ id: 'adapter-candidate', ...input })),
    confirmMemory: vi.fn(async () => 92),
    discardCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(repository as never, adapter as never, identityFor);
  const id = service.proposeProjectMemoryCandidate({
    sessionId: 'session-1',
    workingDirectory: 'project-alpha',
    type: MemoryKind.Decision,
    title: 'Verified decision',
    content: 'The deterministic verifier accepted the durable project decision.',
    taskId: 'task-1',
    runId: 'run-1',
    artifactId: 'artifact-1',
    approvalId: 'approval-1',
    metadata: { artifactIds: ['artifact-1'] },
  });

  expect(repository.candidates.get(id)).toMatchObject({
    projectId: 'project-alpha',
    scope: MemoryScope.Project,
    taskId: 'task-1',
    runId: 'run-1',
  });
  await expect(service.confirmMemoryCandidate(id)).resolves.toBe(92);
  expect(adapter.saveCandidate).toHaveBeenCalledWith(
    expect.objectContaining({ project: 'project-alpha', scope: MemoryScope.Project }),
  );
  expect(repository.links.get(id)).toMatchObject({ memoryId: 92 });
});
