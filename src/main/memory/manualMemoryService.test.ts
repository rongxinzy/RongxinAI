import { expect, test, vi } from 'vitest';
import {
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
  PERSONAL_MEMORY_PROJECT_ID,
} from '../../shared/memory';
import { EngramObservationType, MemoryOutboxOperation, MemoryOutboxStatus } from './constants';
import type { ProjectIdentity } from './projectIdentity';
import { ProjectMemoryService } from './projectMemoryService';
import type { MemoryOutboxItem } from './repository';

function identityFor(cwd: string): ProjectIdentity {
  return { id: `project-${cwd}`, displayName: cwd, root: `/workspace/${cwd}` };
}
const TEST_PERSONAL_DIRECTORY = '/personal-memory';

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
  const service = new ProjectMemoryService(
    repository as never,
    {} as never,
    identityFor,
    TEST_PERSONAL_DIRECTORY,
  );
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
  const service = new ProjectMemoryService(
    repository as never,
    {} as never,
    identityFor,
    TEST_PERSONAL_DIRECTORY,
  );

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
    payload: {
      linkId: link.id,
      projectId: link.projectId,
      observationId: link.memoryId,
      hardDelete: true,
    },
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
  const service = new ProjectMemoryService(
    repository as never,
    adapter as never,
    identityFor,
    TEST_PERSONAL_DIRECTORY,
  );

  await expect(service.forgetMemory(link.id, true)).resolves.toBe(true);

  expect(repository.recordImportRejection).toHaveBeenCalledWith(link.id);
  expect(repository.deleteLink).toHaveBeenCalledWith(link.id);
  expect(adapter.forget).toHaveBeenCalledWith(link.memoryId, true, link.projectId);
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
  const service = new ProjectMemoryService(
    repository as never,
    {} as never,
    identityFor,
    TEST_PERSONAL_DIRECTORY,
  );
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
  const service = new ProjectMemoryService(
    repository as never,
    adapter as never,
    identityFor,
    TEST_PERSONAL_DIRECTORY,
  );

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
    expect.objectContaining({ observationId: target.memoryId, expectedProject: target.projectId }),
  );
  expect(repository.setLinkStatus).toHaveBeenCalledWith(
    target.id,
    MemoryLifecycleStatus.Superseded,
    expect.any(String),
  );
});
