import {
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySourceKind,
  PERSONAL_MEMORY_PROJECT_ID,
  type ManualMemoryCreateInput,
  type ManualMemoryUpdateInput,
  type ManagedMemoryRecord,
} from '../../shared/memory';
import { MANUAL_MEMORY_SESSION_ID } from './constants';
import { normalizeManualMemoryInput } from './memoryRelationshipRules';
import type { ProjectIdentity } from './projectIdentity';
import type { MemoryRepository } from './repository';

interface Operations {
  repository: MemoryRepository;
  resolveIdentity(cwd: string): ProjectIdentity;
  personalDirectory: string;
  confirm(id: string): Promise<number | null>;
}

export async function createManualMemory(
  operations: Operations,
  input: ManualMemoryCreateInput,
): Promise<ManagedMemoryRecord> {
  const normalized = normalizeManualMemoryInput(input);
  const project = operations.resolveIdentity(input.workingDirectory);
  const candidateId = operations.repository.createPersonalCandidate({
    projectId: normalized.scope === MemoryScope.Personal ? PERSONAL_MEMORY_PROJECT_ID : project.id,
    projectRoot:
      normalized.scope === MemoryScope.Personal ? operations.personalDirectory : project.root,
    scope: normalized.scope,
    sessionId: MANUAL_MEMORY_SESSION_ID,
    sourceKind: MemorySourceKind.Explicit,
    title: normalized.title,
    content: normalized.content,
    kind: normalized.kind,
    sensitivity: normalized.sensitivity,
    metadata: { manual: true },
  });
  await operations.confirm(candidateId);
  return requireRecord(operations.repository, candidateId);
}

export async function updateManualMemory(
  operations: Operations,
  input: ManualMemoryUpdateInput,
): Promise<ManagedMemoryRecord> {
  const normalized = normalizeManualMemoryInput(input);
  const candidate = operations.repository.getCandidate(input.id);
  if (candidate) {
    assertBoundary(operations, candidate, input.workingDirectory);
    const updated = operations.repository.updateCandidate(input.id, normalized);
    if (!updated) throw new Error('Memory candidate is not editable.');
    return updated;
  }
  const current = operations.repository.getLink(input.id);
  if (!current || current.status !== MemoryLifecycleStatus.Active)
    throw new Error('Active memory not found.');
  assertBoundary(operations, current, input.workingDirectory);
  const project = operations.resolveIdentity(input.workingDirectory);
  const replacementId = operations.repository.createPersonalCandidate({
    projectId: current.scope === MemoryScope.Personal ? PERSONAL_MEMORY_PROJECT_ID : project.id,
    projectRoot:
      current.scope === MemoryScope.Personal ? operations.personalDirectory : project.root,
    scope: current.scope,
    sessionId: MANUAL_MEMORY_SESSION_ID,
    sourceKind: MemorySourceKind.Explicit,
    title: normalized.title,
    content: normalized.content,
    kind: normalized.kind,
    sensitivity: normalized.sensitivity,
    supersedesLinkId: current.id,
    metadata: { manual: true, editedFrom: current.id },
  });
  await operations.confirm(replacementId);
  return requireRecord(operations.repository, replacementId);
}

function requireRecord(repository: MemoryRepository, id: string): ManagedMemoryRecord {
  const memory = repository.getLink(id) ?? repository.getCandidate(id);
  if (!memory) throw new Error('Memory projection was not created.');
  return memory;
}

function assertBoundary(
  operations: Operations,
  memory: ManagedMemoryRecord,
  workingDirectory: string,
): void {
  if (memory.scope === MemoryScope.Session)
    throw new Error('Session summaries cannot be edited manually.');
  if (memory.scope === MemoryScope.Companion) throw new Error('Memory not found.');
  if (
    memory.scope === MemoryScope.Project &&
    memory.projectId !== operations.resolveIdentity(workingDirectory).id
  )
    throw new Error('Workspace memory belongs to a different workspace.');
}
