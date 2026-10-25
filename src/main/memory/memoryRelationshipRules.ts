import {
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  PERSONAL_MEMORY_PROJECT_ID,
  type ManagedMemoryRecord,
  type ManualMemoryCreateInput,
  type ManualMemoryUpdateInput,
} from '../../shared/memory';

export interface MemoryRelationshipIdentity {
  scope: MemoryScope;
  projectId: string;
  sessionId: string;
}

export function assertCanSupersede(
  replacement: MemoryRelationshipIdentity,
  target: ManagedMemoryRecord,
): void {
  if (target.status !== MemoryLifecycleStatus.Active) {
    throw new Error('Superseded memory must be active.');
  }
  if (replacement.scope !== target.scope || replacement.projectId !== target.projectId) {
    throw new Error('A memory can supersede only an active memory in the same scope.');
  }
  if (replacement.scope === MemoryScope.Session && replacement.sessionId !== target.sessionId) {
    throw new Error('A session memory can supersede only a memory in the same session.');
  }
}

export function assertCanPromote(
  destination: MemoryRelationshipIdentity,
  source: ManagedMemoryRecord,
  sourceProjectId: string,
  originSessionId = destination.sessionId,
): void {
  if (
    destination.scope !== MemoryScope.Personal ||
    destination.projectId !== PERSONAL_MEMORY_PROJECT_ID
  ) {
    throw new Error('Only Personal memory candidates can promote scoped memory.');
  }
  if (source.status !== MemoryLifecycleStatus.Active) {
    throw new Error('Promotion source must be active.');
  }
  if (
    source.scope !== MemoryScope.Project &&
    source.scope !== MemoryScope.Session &&
    source.scope !== MemoryScope.Companion
  ) {
    throw new Error('Only Project or Session memory can be promoted to Personal memory.');
  }
  if (source.projectId !== sourceProjectId) {
    throw new Error('Promotion source must belong to the current workspace.');
  }
  if (source.scope === MemoryScope.Session && source.sessionId !== originSessionId) {
    throw new Error('Session memory can be promoted only from the current session.');
  }
}

export function normalizeManualMemoryInput(
  input: ManualMemoryCreateInput | ManualMemoryUpdateInput,
): Pick<ManualMemoryCreateInput, 'scope' | 'title' | 'content' | 'kind' | 'sensitivity'> {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new Error('Memory title is required.');
  if (!content) throw new Error('Memory content is required.');
  const scope = 'scope' in input ? input.scope : undefined;
  return {
    scope:
      scope === MemoryScope.Project || scope === MemoryScope.Personal
        ? scope
        : MemoryScope.Personal,
    title,
    content,
    kind: input.kind === MemoryKind.Preference ? MemoryKind.Preference : MemoryKind.Decision,
    sensitivity:
      input.sensitivity === MemorySensitivity.Sensitive
        ? MemorySensitivity.Sensitive
        : MemorySensitivity.Normal,
  };
}
