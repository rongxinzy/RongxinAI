import { expect, test } from 'vitest';

import {
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  PERSONAL_MEMORY_PROJECT_ID,
  type ManagedMemoryRecord,
} from '../../shared/memory';
import {
  assertCanPromote,
  assertCanSupersede,
  normalizeManualMemoryInput,
} from './memoryRelationshipRules';

function link(overrides: Partial<ManagedMemoryRecord> = {}): ManagedMemoryRecord {
  return {
    id: 'link-1',
    memoryId: 7,
    projectId: 'project-a',
    scope: MemoryScope.Project,
    sessionId: 'session-1',
    sourceKind: 'explicit',
    taskId: null,
    runId: null,
    artifactId: null,
    approvalId: null,
    status: MemoryLifecycleStatus.Active,
    title: 'Title',
    content: 'Content',
    kind: MemoryKind.Decision,
    topicKey: null,
    importance: 0.5,
    confidence: 0.5,
    sensitivity: MemorySensitivity.Normal,
    expiresAt: null,
    supersededBy: null,
    promotedFromLinkId: null,
    promotionSourceProjectId: null,
    promotionSourceSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deliveryStatus: null,
    deliveryError: null,
    ...overrides,
  };
}

const personalIdentity = {
  scope: MemoryScope.Personal,
  projectId: PERSONAL_MEMORY_PROJECT_ID,
  sessionId: 'session-1',
} as const;

test('assertCanSupersede accepts an active memory in the same scope', () => {
  expect(() =>
    assertCanSupersede(
      { scope: MemoryScope.Project, projectId: 'project-a', sessionId: 'session-1' },
      link(),
    ),
  ).not.toThrow();
});

test('assertCanSupersede rejects an inactive target', () => {
  expect(() =>
    assertCanSupersede(
      { scope: MemoryScope.Project, projectId: 'project-a', sessionId: 'session-1' },
      link({ status: MemoryLifecycleStatus.Superseded }),
    ),
  ).toThrow('Superseded memory must be active.');
});

test('assertCanSupersede rejects a target in another scope or project', () => {
  const replacement = { scope: MemoryScope.Project, projectId: 'project-a', sessionId: 's' };
  expect(() => assertCanSupersede(replacement, link({ scope: MemoryScope.Personal }))).toThrow(
    'A memory can supersede only an active memory in the same scope.',
  );
  expect(() => assertCanSupersede(replacement, link({ projectId: 'project-b' }))).toThrow(
    'A memory can supersede only an active memory in the same scope.',
  );
});

test('assertCanSupersede rejects session supersede across sessions', () => {
  expect(() =>
    assertCanSupersede(
      { scope: MemoryScope.Session, projectId: 'project-a', sessionId: 'session-1' },
      link({ scope: MemoryScope.Session, sessionId: 'session-2' }),
    ),
  ).toThrow('A session memory can supersede only a memory in the same session.');
  expect(() =>
    assertCanSupersede(
      { scope: MemoryScope.Session, projectId: 'project-a', sessionId: 'session-1' },
      link({ scope: MemoryScope.Session, sessionId: 'session-1' }),
    ),
  ).not.toThrow();
});

test('assertCanPromote accepts active Project and current-session memory', () => {
  expect(() => assertCanPromote(personalIdentity, link(), 'project-a')).not.toThrow();
  expect(() =>
    assertCanPromote(
      personalIdentity,
      link({ scope: MemoryScope.Session, sessionId: 'session-1' }),
      'project-a',
    ),
  ).not.toThrow();
});

test('assertCanPromote rejects non-Personal destinations', () => {
  expect(() =>
    assertCanPromote(
      { scope: MemoryScope.Project, projectId: 'project-a', sessionId: 'session-1' },
      link(),
      'project-a',
    ),
  ).toThrow('Only Personal memory candidates can promote scoped memory.');
});

test('assertCanPromote rejects inactive, Personal, foreign-workspace, and foreign-session sources', () => {
  expect(() =>
    assertCanPromote(
      personalIdentity,
      link({ status: MemoryLifecycleStatus.Archived }),
      'project-a',
    ),
  ).toThrow('Promotion source must be active.');
  expect(() =>
    assertCanPromote(personalIdentity, link({ scope: MemoryScope.Personal }), 'project-a'),
  ).toThrow('Only Project or Session memory can be promoted to Personal memory.');
  expect(() => assertCanPromote(personalIdentity, link(), 'project-b')).toThrow(
    'Promotion source must belong to the current workspace.',
  );
  expect(() =>
    assertCanPromote(
      personalIdentity,
      link({ scope: MemoryScope.Session, sessionId: 'session-2' }),
      'project-a',
    ),
  ).toThrow('Session memory can be promoted only from the current session.');
});

test('assertCanPromote honors an explicit origin session id', () => {
  expect(() =>
    assertCanPromote(
      { ...personalIdentity, sessionId: 'session-2' },
      link({ scope: MemoryScope.Session, sessionId: 'session-3' }),
      'project-a',
      'session-3',
    ),
  ).not.toThrow();
});

test('normalizeManualMemoryInput trims and validates title and content', () => {
  expect(() =>
    normalizeManualMemoryInput({
      workingDirectory: 'a',
      scope: MemoryScope.Personal,
      title: '  ',
      content: 'Content',
      kind: MemoryKind.Decision,
      sensitivity: MemorySensitivity.Normal,
    }),
  ).toThrow('Memory title is required.');
  expect(() =>
    normalizeManualMemoryInput({
      id: 'link-1',
      workingDirectory: 'a',
      title: 'Title',
      content: '   ',
      kind: MemoryKind.Decision,
      sensitivity: MemorySensitivity.Normal,
    }),
  ).toThrow('Memory content is required.');
});

test('normalizeManualMemoryInput defaults scope, kind, and sensitivity', () => {
  const update = normalizeManualMemoryInput({
    id: 'link-1',
    workingDirectory: 'a',
    title: ' Title ',
    content: ' Content ',
    kind: 'unknown-kind' as never,
    sensitivity: 'unknown' as never,
  });
  expect(update).toEqual({
    scope: MemoryScope.Personal,
    title: 'Title',
    content: 'Content',
    kind: MemoryKind.Decision,
    sensitivity: MemorySensitivity.Normal,
  });

  const create = normalizeManualMemoryInput({
    workingDirectory: 'a',
    scope: MemoryScope.Project,
    title: 'Title',
    content: 'Content',
    kind: MemoryKind.Preference,
    sensitivity: MemorySensitivity.Sensitive,
  });
  expect(create).toEqual({
    scope: MemoryScope.Project,
    title: 'Title',
    content: 'Content',
    kind: MemoryKind.Preference,
    sensitivity: MemorySensitivity.Sensitive,
  });
});
