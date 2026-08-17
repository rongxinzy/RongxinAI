import Database from 'better-sqlite3';
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
import { MemoryRepository } from './repository';

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
      promotedFromLinkId: input?.promotedFromLinkId ?? null,
      promotionSourceProjectId: input?.promotionSourceProjectId ?? null,
      promotionSourceSessionId: input?.promotionSourceSessionId ?? null,
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
    promotedFromLinkId: input.promotedFromLinkId ?? null,
    promotionSourceProjectId: input.promotionSourceProjectId ?? null,
    promotionSourceSessionId: input.promotionSourceSessionId ?? null,
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
    workingDirectory: 'project-alpha',
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

function createMemoryServiceFixture() {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);
  let nextMemoryId = 100;
  const adapter = {
    saveCandidate: vi.fn(input => ({ id: `adapter-candidate-${nextMemoryId}`, ...input })),
    confirmMemory: vi.fn(async () => nextMemoryId++),
    supersede: vi.fn(async (): Promise<number | null> => nextMemoryId++),
    discardCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(
    repository,
    adapter as never,
    identityFor,
    'C:/private/memory',
  );
  return { adapter, db, repository, service };
}

function createActiveLink(
  repository: MemoryRepository,
  input: {
    id: string;
    memoryId: number;
    projectId: string;
    scope: ManagedMemoryRecord['scope'];
    sessionId: string;
  },
) {
  repository.createLink({
    ...input,
    sourceKind:
      input.scope === MemoryScope.Session
        ? MemorySourceKind.SessionSummary
        : MemorySourceKind.Explicit,
    title: input.id,
    content: `Content for ${input.id}`,
    kind: input.scope === MemoryScope.Session ? MemoryKind.SessionSummary : MemoryKind.Decision,
  });
}

test('allows Personal memory to supersede only active Personal memory', async () => {
  const { adapter, db, repository, service } = createMemoryServiceFixture();
  try {
    createActiveLink(repository, {
      id: 'personal-old',
      memoryId: 1,
      projectId: PERSONAL_MEMORY_PROJECT_ID,
      scope: MemoryScope.Personal,
      sessionId: 'older-session',
    });
    const candidateId = service.proposePersonalMemory({
      sessionId: 'session-a',
      workingDirectory: 'project-a',
      type: MemoryKind.Preference,
      title: 'Updated preference',
      content: 'Prefer the newer setting.',
      supersedesMemoryId: 1,
    });

    await expect(service.confirmPersonalCandidate(candidateId)).resolves.toBe(100);
    expect(adapter.supersede).toHaveBeenCalledWith(expect.objectContaining({ observationId: 1 }));
    expect(repository.getLink('personal-old')?.status).toBe(MemoryLifecycleStatus.Superseded);
  } finally {
    db.close();
  }
});

test('keeps the existing Personal memory active when supersede propagation fails', async () => {
  const { adapter, db, repository, service } = createMemoryServiceFixture();
  try {
    createActiveLink(repository, {
      id: 'personal-still-active',
      memoryId: 11,
      projectId: PERSONAL_MEMORY_PROJECT_ID,
      scope: MemoryScope.Personal,
      sessionId: 'older-session',
    });
    const candidateId = service.proposePersonalMemory({
      sessionId: 'session-a',
      workingDirectory: 'project-a',
      type: MemoryKind.Preference,
      title: 'Deferred replacement',
      content: 'Do not retire the old preference until this is durable.',
      supersedesMemoryId: 11,
    });
    adapter.supersede.mockResolvedValueOnce(null);

    await expect(service.confirmPersonalCandidate(candidateId)).resolves.toBeNull();
    expect(repository.getLink('personal-still-active')?.status).toBe(MemoryLifecycleStatus.Active);
    expect(repository.getCandidate(candidateId)?.status).toBe(MemoryLifecycleStatus.NeedsReview);
  } finally {
    db.close();
  }
});

test.each([
  [MemoryScope.Project, 'project-a', 'session-a'],
  [MemoryScope.Session, 'project-a', 'session-a'],
] as const)('rejects Personal supersede targets in %s scope', (scope, projectId, sessionId) => {
  const { db, repository, service } = createMemoryServiceFixture();
  try {
    createActiveLink(repository, {
      id: `non-personal-${scope}`,
      memoryId: 2,
      projectId,
      scope,
      sessionId,
    });

    expect(() =>
      service.proposePersonalMemory({
        sessionId: 'session-a',
        workingDirectory: 'project-a',
        type: MemoryKind.Preference,
        title: 'Invalid replacement',
        content: 'This must not cross scope.',
        supersedesMemoryId: 2,
      }),
    ).toThrow('same scope');
  } finally {
    db.close();
  }
});

test('fails closed when a supersede target does not exist', () => {
  const { db, service } = createMemoryServiceFixture();
  try {
    expect(() =>
      service.proposePersonalMemory({
        sessionId: 'session-a',
        workingDirectory: 'project-a',
        type: MemoryKind.Preference,
        title: 'Missing replacement',
        content: 'The missing target must not degrade into a normal proposal.',
        supersedesMemoryId: 999,
      }),
    ).toThrow('Superseded memory was not found');
  } finally {
    db.close();
  }
});

test('promotes current workspace Project memory without changing the source lifecycle', async () => {
  const { db, repository, service } = createMemoryServiceFixture();
  try {
    createActiveLink(repository, {
      id: 'project-source',
      memoryId: 3,
      projectId: 'project-a',
      scope: MemoryScope.Project,
      sessionId: 'session-origin',
    });
    const candidateId = service.proposePersonalMemory({
      sessionId: 'session-a',
      workingDirectory: 'project-a',
      type: MemoryKind.Preference,
      title: 'Promoted project preference',
      content: 'Carry this preference across workspaces.',
      promotesMemoryId: 3,
    });

    expect(repository.getCandidate(candidateId)).toMatchObject({
      promotedFromLinkId: 'project-source',
      promotionSourceProjectId: 'project-a',
      promotionSourceSessionId: null,
    });
    await expect(service.confirmPersonalCandidate(candidateId)).resolves.toBe(100);
    expect(repository.getLink('project-source')?.status).toBe(MemoryLifecycleStatus.Active);
    expect(repository.getLink(candidateId)).toMatchObject({
      scope: MemoryScope.Personal,
      promotedFromLinkId: 'project-source',
      promotionSourceProjectId: 'project-a',
      promotionSourceSessionId: null,
    });
  } finally {
    db.close();
  }
});

test('rejects Project promotion from another workspace', () => {
  const { db, repository, service } = createMemoryServiceFixture();
  try {
    createActiveLink(repository, {
      id: 'other-project-source',
      memoryId: 4,
      projectId: 'project-b',
      scope: MemoryScope.Project,
      sessionId: 'session-a',
    });

    expect(() =>
      service.proposePersonalMemory({
        sessionId: 'session-a',
        workingDirectory: 'project-a',
        type: MemoryKind.Preference,
        title: 'Foreign project preference',
        content: 'This source is outside the current workspace.',
        promotesMemoryId: 4,
      }),
    ).toThrow('current workspace');
  } finally {
    db.close();
  }
});

test('promotes Session memory only from the current workspace and session', async () => {
  const { db, repository, service } = createMemoryServiceFixture();
  try {
    createActiveLink(repository, {
      id: 'session-source',
      memoryId: 5,
      projectId: 'project-a',
      scope: MemoryScope.Session,
      sessionId: 'session-a',
    });
    createActiveLink(repository, {
      id: 'other-session-source',
      memoryId: 6,
      projectId: 'project-a',
      scope: MemoryScope.Session,
      sessionId: 'session-b',
    });

    const candidateId = service.proposePersonalMemory({
      sessionId: 'session-a',
      workingDirectory: 'project-a',
      type: MemoryKind.Preference,
      title: 'Promoted session preference',
      content: 'This session finding should become personal.',
      promotesMemoryId: 5,
    });
    await expect(service.confirmPersonalCandidate(candidateId)).resolves.toBe(100);
    expect(repository.getLink('session-source')?.status).toBe(MemoryLifecycleStatus.Active);

    expect(() =>
      service.proposePersonalMemory({
        sessionId: 'session-a',
        workingDirectory: 'project-a',
        type: MemoryKind.Preference,
        title: 'Foreign session preference',
        content: 'This source belongs to another session.',
        promotesMemoryId: 6,
      }),
    ).toThrow('current session');
  } finally {
    db.close();
  }
});

test('revalidates supersede targets and promotion sources when a candidate is confirmed', async () => {
  const { db, repository, service } = createMemoryServiceFixture();
  try {
    createActiveLink(repository, {
      id: 'personal-target',
      memoryId: 7,
      projectId: PERSONAL_MEMORY_PROJECT_ID,
      scope: MemoryScope.Personal,
      sessionId: 'older-session',
    });
    createActiveLink(repository, {
      id: 'project-promotion-source',
      memoryId: 8,
      projectId: 'project-a',
      scope: MemoryScope.Project,
      sessionId: 'session-a',
    });
    const supersedeCandidate = service.proposePersonalMemory({
      sessionId: 'session-a',
      workingDirectory: 'project-a',
      type: MemoryKind.Preference,
      title: 'Replacement',
      content: 'Replacement content.',
      supersedesMemoryId: 7,
    });
    const promotionCandidate = service.proposePersonalMemory({
      sessionId: 'session-a',
      workingDirectory: 'project-a',
      type: MemoryKind.Preference,
      title: 'Promotion',
      content: 'Promotion content.',
      promotesMemoryId: 8,
    });
    repository.setLinkStatus('personal-target', MemoryLifecycleStatus.Archived);
    repository.setLinkStatus('project-promotion-source', MemoryLifecycleStatus.Archived);

    await expect(service.confirmPersonalCandidate(supersedeCandidate)).rejects.toThrow(
      'must be active',
    );
    await expect(service.confirmPersonalCandidate(promotionCandidate)).rejects.toThrow(
      'must be active',
    );
  } finally {
    db.close();
  }
});

test('can promote scoped memory while superseding an existing Personal memory', async () => {
  const { db, repository, service } = createMemoryServiceFixture();
  try {
    createActiveLink(repository, {
      id: 'personal-target-combined',
      memoryId: 9,
      projectId: PERSONAL_MEMORY_PROJECT_ID,
      scope: MemoryScope.Personal,
      sessionId: 'older-session',
    });
    createActiveLink(repository, {
      id: 'project-source-combined',
      memoryId: 10,
      projectId: 'project-a',
      scope: MemoryScope.Project,
      sessionId: 'session-a',
    });
    const candidateId = service.proposePersonalMemory({
      sessionId: 'session-a',
      workingDirectory: 'project-a',
      type: MemoryKind.Preference,
      title: 'Combined promotion',
      content: 'Promote the project fact and replace the old personal preference.',
      promotesMemoryId: 10,
      supersedesMemoryId: 9,
    });

    await expect(service.confirmPersonalCandidate(candidateId)).resolves.toBe(100);
    expect(repository.getLink('personal-target-combined')?.status).toBe(
      MemoryLifecycleStatus.Superseded,
    );
    expect(repository.getLink('project-source-combined')?.status).toBe(
      MemoryLifecycleStatus.Active,
    );
    expect(repository.getLink(candidateId)).toMatchObject({
      promotedFromLinkId: 'project-source-combined',
      promotionSourceProjectId: 'project-a',
    });
  } finally {
    db.close();
  }
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
