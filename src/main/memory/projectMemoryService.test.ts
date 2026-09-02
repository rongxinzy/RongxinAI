import { expect, test, vi } from 'vitest';

import {
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
  PERSONAL_MEMORY_PROJECT_ID,
} from '../../shared/memory';
import {
  EngramMemoryScope,
  EngramObservationType,
  EngramSearchMatchMode,
  MemoryOutboxOperation,
  MemoryOutboxStatus,
} from './constants';
import type { ProjectIdentity } from './projectIdentity';
import { ProjectMemoryService } from './projectMemoryService';
import type { MemoryOutboxItem } from './repository';

class FakeRepository {
  items: MemoryOutboxItem[] = [];
  links: Array<Record<string, unknown>> = [];

  enqueue(operation: typeof MemoryOutboxOperation.Confirm, payload: Record<string, unknown>) {
    const id = `outbox-${this.items.length + 1}`;
    this.items.push({
      id,
      operation,
      payload,
      status: MemoryOutboxStatus.Pending,
      attempts: 0,
      availableAt: new Date(0).toISOString(),
      lastError: null,
    });
    return id;
  }

  listPending() {
    return this.items.filter(item => item.status === MemoryOutboxStatus.Pending);
  }

  filterRecallableMemoryIds(input: { memoryIds: number[] }) {
    return new Set(input.memoryIds);
  }

  listManaged() {
    return [];
  }

  getRecallMetadata() {
    return new Map();
  }

  findActiveTopic() {
    return null;
  }

  getLinkMetadata() {
    return {};
  }

  isCurrentSemanticMemoryLink() {
    return true;
  }

  supersedeActiveTopic() {}

  createLink(input: Record<string, unknown>) {
    this.links.push(input);
    return String(input.id);
  }

  markCompleted(id: string) {
    const item = this.items.find(candidate => candidate.id === id);
    if (item) item.status = MemoryOutboxStatus.Completed;
  }

  markRetry(id: string, attempts: number, error: string) {
    const item = this.items.find(candidate => candidate.id === id);
    if (item) {
      item.attempts = attempts;
      item.lastError = error;
    }
  }
}

function identityFor(cwd: string): ProjectIdentity {
  return {
    id: `project-${cwd}`,
    displayName: cwd,
    root: `/workspace/${cwd}`,
  };
}

test('always recalls with the current project identity', async () => {
  const recall = vi.fn(async () => []);
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    { recall } as never,
    identityFor,
  );

  await service.recallProject({ workingDirectory: 'alpha', query: 'database' });
  await service.recallProject({ workingDirectory: 'beta', query: 'database' });

  expect(recall.mock.calls[0][0]).toMatchObject({
    project: 'project-alpha',
    scope: EngramMemoryScope.Project,
  });
  expect(recall.mock.calls[1][0]).toMatchObject({ project: 'project-beta' });
});

test('filters managed memories to the selected workspace while retaining personal memories', () => {
  const memories = [
    { id: 'project-alpha', scope: MemoryScope.Project, projectId: 'project-alpha' },
    { id: 'project-beta', scope: MemoryScope.Project, projectId: 'project-beta' },
    { id: 'session-alpha', scope: MemoryScope.Session, projectId: 'project-alpha' },
    { id: 'personal', scope: MemoryScope.Personal, projectId: PERSONAL_MEMORY_PROJECT_ID },
  ];
  const listManaged = vi.fn(() => memories);
  const service = new ProjectMemoryService({ listManaged } as never, {} as never, identityFor);

  expect(
    service.listManagedMemories({ workingDirectory: 'alpha' }).map(memory => memory.id),
  ).toEqual(['project-alpha', 'session-alpha', 'personal']);
  expect(listManaged).toHaveBeenCalledWith({ workingDirectory: 'alpha' });
});

test('returns referenced memory only when it is recallable in the current boundary', () => {
  const findLinkByMemoryId = vi.fn((memoryId: number) => ({
    memoryId,
    status: MemoryLifecycleStatus.Active,
    scope: MemoryScope.Project,
    projectId: memoryId === 1 ? 'project-alpha' : 'project-beta',
    sessionId: 'session-1',
  }));
  const service = new ProjectMemoryService(
    { findLinkByMemoryId, isCurrentSemanticMemoryLink: vi.fn(() => true) } as never,
    {} as never,
    identityFor,
  );

  expect(
    service.getRecallableMemoryById({
      workingDirectory: 'alpha',
      sessionId: 'session-1',
      memoryId: 1,
    }),
  ).toMatchObject({ memoryId: 1, projectId: 'project-alpha' });
  expect(
    service.getRecallableMemoryById({
      workingDirectory: 'alpha',
      sessionId: 'session-1',
      memoryId: 2,
    }),
  ).toBeNull();
});

test('persists the outbox before confirming and linking a project memory', async () => {
  const repository = new FakeRepository();
  const adapter = {
    saveCandidate: vi.fn(input => ({ id: 'candidate-1', ...input })),
    confirmMemory: vi.fn(async () => 42),
    discardCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(repository as never, adapter as never, identityFor);

  await expect(
    service.saveProjectMemory({
      sessionId: 'session-1',
      workingDirectory: 'alpha',
      type: EngramObservationType.Decision,
      title: 'Database',
      content: 'Use SQLite.',
      importance: 0.8,
      confidence: 0.95,
      metadata: { extractorVersion: 1, sourceIds: ['message-1'] },
    }),
  ).resolves.toBe(42);

  expect(repository.items[0]).toMatchObject({ status: MemoryOutboxStatus.Completed });
  expect(repository.links[0]).toMatchObject({
    memoryId: 42,
    projectId: 'project-alpha',
    sessionId: 'session-1',
    importance: 0.8,
    confidence: 0.95,
    metadata: { extractorVersion: 1, sourceIds: ['message-1'] },
  });
});

test('creates manual memory as a controlled candidate before confirmation', async () => {
  const active = {
    id: 'manual-candidate',
    memoryId: 52,
    projectId: PERSONAL_MEMORY_PROJECT_ID,
    scope: MemoryScope.Personal,
    status: MemoryLifecycleStatus.Active,
  };
  const repository = {
    createPersonalCandidate: vi.fn(() => active.id),
    getLink: vi.fn(() => active),
    getCandidate: vi.fn(() => null),
  };
  const service = new ProjectMemoryService(repository as never, {} as never, identityFor);
  const confirm = vi.spyOn(service, 'confirmMemoryCandidate').mockResolvedValue(active.memoryId);

  await expect(
    service.createManualMemory({
      workingDirectory: 'alpha',
      scope: MemoryScope.Personal,
      title: 'Editor preference',
      content: 'Use compact tables.',
      kind: MemoryKind.Preference,
      sensitivity: MemorySensitivity.Normal,
    }),
  ).resolves.toBe(active);

  expect(repository.createPersonalCandidate).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: MemoryScope.Personal,
      sourceKind: MemorySourceKind.Explicit,
      title: 'Editor preference',
      content: 'Use compact tables.',
    }),
  );
  expect(confirm).toHaveBeenCalledWith(active.id);
});

test('records a rejected legacy candidate without retaining its content', async () => {
  const candidate = {
    id: 'legacy-memory:abc',
    memoryId: null,
    projectId: PERSONAL_MEMORY_PROJECT_ID,
    scope: MemoryScope.Personal,
    sourceKind: MemorySourceKind.LegacySqliteImport,
    status: MemoryLifecycleStatus.NeedsReview,
  };
  const repository = {
    getCandidate: vi.fn(() => candidate),
    rejectCandidate: vi.fn(),
    deleteCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(repository as never, {} as never, identityFor);

  await expect(service.forgetMemory(candidate.id, false)).resolves.toBe(true);

  expect(repository.rejectCandidate).toHaveBeenCalledWith(candidate.id);
  expect(repository.deleteCandidate).not.toHaveBeenCalled();
});

test('records an import rejection before permanently forgetting a confirmed legacy memory', async () => {
  const link = {
    id: 'legacy-memory:confirmed',
    memoryId: 81,
    projectId: PERSONAL_MEMORY_PROJECT_ID,
    scope: MemoryScope.Personal,
    sourceKind: MemorySourceKind.LegacyFileImport,
    status: MemoryLifecycleStatus.Active,
  };
  const pending = {
    id: 'outbox-forget',
    operation: MemoryOutboxOperation.Forget,
    payload: { linkId: link.id, observationId: link.memoryId, hardDelete: true },
    status: MemoryOutboxStatus.Pending,
    attempts: 0,
    availableAt: new Date(0).toISOString(),
    lastError: null,
  };
  const repository = {
    getCandidate: vi.fn(() => null),
    getLink: vi.fn(() => link),
    recordImportRejection: vi.fn(),
    setLinkStatus: vi.fn(),
    enqueue: vi.fn(() => pending.id),
    listPending: vi.fn(() => [pending]),
    markCompleted: vi.fn(),
    deleteLink: vi.fn(),
  };
  const adapter = { forget: vi.fn(async () => true) };
  const service = new ProjectMemoryService(repository as never, adapter as never, identityFor);

  await expect(service.forgetMemory(link.id, true)).resolves.toBe(true);

  expect(repository.recordImportRejection).toHaveBeenCalledWith(link.id);
  expect(repository.deleteLink).toHaveBeenCalledWith(link.id);
});

test('does not reimport a legacy entry with a rejection receipt', () => {
  const repository = {
    hasImportRejection: vi.fn(() => true),
    getCandidate: vi.fn(),
    getLink: vi.fn(),
    createPersonalCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(repository as never, {} as never, identityFor);

  expect(
    service.importLegacyPersonalMemoryCandidate({
      id: 'legacy-memory:rejected',
      title: 'Rejected memory',
      content: 'Do not import this again.',
      sourceKind: MemorySourceKind.LegacySqliteImport,
      metadata: {},
    }),
  ).toBe(false);
  expect(repository.createPersonalCandidate).not.toHaveBeenCalled();
});

test('edits active manual memory by confirming a superseding candidate', async () => {
  const current = {
    id: 'current-link',
    memoryId: 51,
    projectId: 'project-alpha',
    scope: MemoryScope.Project,
    status: MemoryLifecycleStatus.Active,
  };
  const replacement = { ...current, id: 'replacement-link', memoryId: 52 };
  const repository = {
    getCandidate: vi.fn(() => null),
    getLink: vi.fn((id: string) => (id === current.id ? current : replacement)),
    createPersonalCandidate: vi.fn(() => replacement.id),
  };
  const service = new ProjectMemoryService(repository as never, {} as never, identityFor);
  const confirm = vi
    .spyOn(service, 'confirmMemoryCandidate')
    .mockResolvedValue(replacement.memoryId);

  await expect(
    service.updateManualMemory({
      id: current.id,
      workingDirectory: 'alpha',
      title: 'Database choice',
      content: 'Use SQLite with WAL.',
      kind: MemoryKind.Decision,
      sensitivity: MemorySensitivity.Normal,
    }),
  ).resolves.toBe(replacement);

  expect(repository.createPersonalCandidate).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: 'project-alpha',
      scope: MemoryScope.Project,
      supersedesLinkId: current.id,
      sourceKind: MemorySourceKind.Explicit,
    }),
  );
  expect(confirm).toHaveBeenCalledWith(replacement.id);
});

test('supersedes a legacy Project link through the durable outbox', async () => {
  const target = {
    id: 'legacy-project-link',
    memoryId: 41,
    projectId: 'project-alpha',
    scope: MemoryScope.Project,
    sessionId: 'session-old',
    status: MemoryLifecycleStatus.Active,
  };
  let pending: MemoryOutboxItem | null = null;
  const repository = {
    getLink: vi.fn(() => target),
    findLinkByMemoryId: vi.fn(() => target),
    enqueue: vi.fn((operation, payload, linkId) => {
      pending = {
        id: 'outbox-supersede',
        linkId,
        operation,
        payload,
        status: MemoryOutboxStatus.Pending,
        attempts: 0,
        availableAt: new Date(0).toISOString(),
        lastError: null,
      };
      return pending.id;
    }),
    listPending: vi.fn(() => (pending ? [pending] : [])),
    createLink: vi.fn(),
    setLinkStatus: vi.fn(),
    supersedeActiveTopic: vi.fn(),
    markCompleted: vi.fn(),
    markRetry: vi.fn(),
  };
  const adapter = {
    saveCandidate: vi.fn(input => ({ id: 'replacement-candidate', ...input })),
    supersede: vi.fn(async () => 42),
    discardCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(repository as never, adapter as never, identityFor);

  const memoryId = await service.saveProjectMemory({
    sessionId: 'session-new',
    workingDirectory: 'alpha',
    type: EngramObservationType.Decision,
    title: 'Project store',
    content: 'Use SQLite.',
    supersedesLinkId: target.id,
  });

  expect(repository.markRetry).not.toHaveBeenCalled();
  expect(memoryId).toBe(42);

  expect(repository.enqueue).toHaveBeenCalledWith(
    MemoryOutboxOperation.Supersede,
    expect.objectContaining({
      supersedesLinkId: target.id,
      supersededObservationId: target.memoryId,
    }),
    expect.any(String),
  );
  expect(adapter.supersede).toHaveBeenCalledWith(
    expect.objectContaining({ observationId: target.memoryId }),
  );
  expect(repository.setLinkStatus).toHaveBeenCalledWith(
    target.id,
    MemoryLifecycleStatus.Superseded,
    expect.any(String),
  );
});

test('keeps an unavailable write pending for a later outbox drain', async () => {
  const repository = new FakeRepository();
  const adapter = {
    saveCandidate: vi.fn(input => ({ id: 'candidate-1', ...input })),
    confirmMemory: vi.fn(async () => null),
    discardCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(repository as never, adapter as never, identityFor);

  await service.saveProjectMemory({
    sessionId: 'session-1',
    workingDirectory: 'alpha',
    type: EngramObservationType.Decision,
    title: 'Database',
    content: 'Use SQLite.',
  });

  expect(repository.items[0]).toMatchObject({
    status: MemoryOutboxStatus.Pending,
    attempts: 1,
    lastError: 'Memory runtime unavailable.',
  });
  expect(adapter.discardCandidate).toHaveBeenCalledWith('candidate-1');
  expect(repository.links).toHaveLength(0);
});

test('enforces the project context token budget', async () => {
  const adapter = {
    recall: vi.fn(async (input: { scope: string }) =>
      input.scope !== EngramMemoryScope.Project
        ? []
        : [
            { id: 1, title: 'First', content: 'A'.repeat(40) },
            { id: 2, title: 'Second', content: 'B'.repeat(400) },
          ],
    ),
  };
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    adapter as never,
    identityFor,
  );

  const context = await service.buildProjectContext({
    workingDirectory: 'alpha',
    sessionId: 'session-1',
    query: 'database',
    tokenBudget: 30,
  });

  expect(context).toContain('[memory:1]');
  expect(context).not.toContain('[memory:2]');
});

test('broadens an empty CJK search with any-match terms', async () => {
  const recall = vi.fn(async (input: { matchMode: string }) =>
    input.matchMode === EngramSearchMatchMode.Any
      ? [
          {
            id: 9,
            title: 'Project database',
            content: 'Use SQLite.',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]
      : [],
  );
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    { recall, recent: vi.fn(async () => []) } as never,
    identityFor,
  );

  await expect(
    service.recallProject({ workingDirectory: 'alpha', query: '我们项目使用什么数据库' }),
  ).resolves.toMatchObject([{ id: 9 }]);
  expect(recall).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ matchMode: EngramSearchMatchMode.Any }),
  );
});

test('falls back to bounded recent active memory only for explicit memory intent', async () => {
  const recent = vi.fn(async () => [
    {
      id: 10,
      title: 'Current project',
      content: 'The project is ZhiYuan.',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ]);
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    { recall: vi.fn(async () => []), recent } as never,
    identityFor,
  );

  await expect(
    service.recallProject({ workingDirectory: 'alpha', query: '当前项目是什么' }),
  ).resolves.toMatchObject([{ id: 10 }]);
  expect(recent).toHaveBeenCalledWith({
    project: 'project-alpha',
    scope: EngramMemoryScope.Project,
    limit: 8,
  });
});

test('lists the current workspace, confirmed personal, and current-session memories', () => {
  const memories = [
    { id: 'project-current', projectId: 'project-alpha', scope: EngramMemoryScope.Project },
    { id: 'project-other', projectId: 'project-beta', scope: EngramMemoryScope.Project },
    {
      id: 'personal',
      projectId: 'personal://zhiyuan-agent/user',
      scope: EngramMemoryScope.Personal,
    },
    {
      id: 'session-current',
      projectId: 'project-alpha',
      scope: EngramMemoryScope.Session,
      sessionId: 'session-a',
    },
    {
      id: 'session-other',
      projectId: 'project-alpha',
      scope: EngramMemoryScope.Session,
      sessionId: 'session-b',
    },
  ];
  const service = new ProjectMemoryService(
    {
      listManaged: vi.fn(() => memories),
      isCurrentSemanticMemoryLink: vi.fn(() => true),
    } as never,
    {} as never,
    identityFor,
  );

  expect(
    service.listRecallableMemories({ workingDirectory: 'alpha' }).map(memory => memory.id),
  ).toEqual(['project-current', 'personal']);
  expect(
    service
      .listRecallableMemories({ workingDirectory: 'alpha', sessionId: 'session-a' })
      .map(memory => memory.id),
  ).toEqual(['project-current', 'personal', 'session-current']);
});

test('does not expose legacy copy-style Session summaries through controlled listing', () => {
  const service = new ProjectMemoryService(
    {
      listManaged: vi.fn(() => [
        {
          id: 'legacy-session',
          projectId: 'project-alpha',
          scope: EngramMemoryScope.Session,
          sessionId: 'session-a',
        },
      ]),
      isCurrentSemanticMemoryLink: vi.fn(() => false),
    } as never,
    {} as never,
    identityFor,
  );

  expect(
    service.listRecallableMemories({ workingDirectory: 'alpha', sessionId: 'session-a' }),
  ).toEqual([]);
});

test('stores rolling session summaries with a 30 day expiration', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-11T00:00:00.000Z'));
  const repository = new FakeRepository();
  const adapter = {
    saveCandidate: vi.fn(input => ({ id: 'candidate-summary', ...input })),
    confirmMemory: vi.fn(async () => 21),
    discardCandidate: vi.fn(),
  };
  const service = new ProjectMemoryService(repository as never, adapter as never, identityFor);

  await expect(
    service.saveSessionSummary({
      sessionId: 'session-1',
      workingDirectory: 'alpha',
      summary: 'Semantic session memory (v1)\nGoal: Fix recall\nCurrent state: Verified',
      metadata: {
        extractorVersion: 1,
        sourceMessageIds: ['message-1'],
        digest: { shouldSave: true },
      },
    }),
  ).resolves.toBe(21);

  expect(repository.items[0].payload).toMatchObject({
    scope: EngramMemoryScope.Session,
    topicKey: 'session/session-1',
    expiresAt: '2026-09-10T00:00:00.000Z',
    metadata: {
      extractorVersion: 1,
      sourceMessageIds: ['message-1'],
      digest: { shouldSave: true },
    },
  });
  expect(repository.links[0]).toMatchObject({
    metadata: {
      extractorVersion: 1,
      sourceMessageIds: ['message-1'],
      digest: { shouldSave: true },
    },
  });
  vi.useRealTimers();
});

test('injects only the current session recall under its own context budget', async () => {
  const adapter = {
    recall: vi.fn(async (input: { scope: string; limit: number }) =>
      input.scope === EngramMemoryScope.Session
        ? [
            ...Array.from({ length: 8 }, (_, index) => ({
              id: 100 + index,
              session_id: `other-session-${index}`,
              type: EngramObservationType.SessionSummary,
              title: 'Other session summary',
              content: 'Private result from another session.',
              updated_at: '2026-08-12T00:00:00.000Z',
            })),
            {
              id: 31,
              session_id: 'session-1',
              type: EngramObservationType.SessionSummary,
              title: 'Session summary',
              content: 'The previous session fixed CJK recall.',
              updated_at: '2026-08-11T00:00:00.000Z',
            },
          ].slice(0, input.limit)
        : [],
    ),
  };
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    adapter as never,
    identityFor,
  );

  await expect(
    service.buildProjectContext({
      workingDirectory: 'alpha',
      sessionId: 'session-1',
      query: 'CJK recall',
    }),
  ).resolves.toContain('Session:\n- [memory:31]');
  expect(adapter.recall).toHaveBeenCalledWith(
    expect.objectContaining({ scope: EngramMemoryScope.Session, limit: 20 }),
  );
  await expect(
    service.recallSession({
      workingDirectory: 'alpha',
      sessionId: 'session-1',
      query: 'CJK recall',
    }),
  ).resolves.toEqual([expect.objectContaining({ id: 31 })]);
});

test('excludes session summaries returned by project recall', async () => {
  const adapter = {
    recall: vi.fn(async () => [
      {
        id: 51,
        session_id: 'session-2',
        type: EngramObservationType.SessionSummary,
        title: 'Leaked session summary',
        content: 'Private result from another session.',
        updated_at: '2026-08-11T00:00:00.000Z',
      },
      {
        id: 52,
        session_id: 'session-2',
        type: EngramObservationType.Decision,
        title: 'Project decision',
        content: 'Use SQLite.',
        updated_at: '2026-08-11T00:00:00.000Z',
      },
    ]),
  };
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    adapter as never,
    identityFor,
  );

  await expect(
    service.recallProject({ workingDirectory: 'alpha', query: 'database' }),
  ).resolves.toEqual([expect.objectContaining({ id: 52 })]);
});

test('counts CJK characters conservatively against context budgets', async () => {
  const adapter = {
    recall: vi.fn(async (input: { scope: string }) =>
      input.scope === EngramMemoryScope.Project
        ? [{ id: 41, title: '中文', content: '记'.repeat(80) }]
        : [],
    ),
  };
  const service = new ProjectMemoryService(
    new FakeRepository() as never,
    adapter as never,
    identityFor,
  );

  await expect(
    service.buildProjectContext({
      workingDirectory: 'alpha',
      sessionId: 'session-1',
      query: 'budget',
      tokenBudget: 30,
    }),
  ).resolves.toBe('');
});
