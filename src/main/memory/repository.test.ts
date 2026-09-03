import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';

import {
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySourceKind,
  MemorySummaryFormat,
} from '../../shared/memory';
import {
  MemoryExtractorKind,
  MemoryOutboxOperation,
  MemoryRecordStorageKind,
  PERSONAL_MEMORY_SESSION_PREFIX,
} from './constants';
import { MemoryRepository } from './repository';

test('selects only active legacy session summaries for semantic backfill', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);

  try {
    repository.createLink({
      id: 'legacy-summary',
      memoryId: 1,
      projectId: 'project-a',
      scope: MemoryScope.Session,
      sessionId: 'session-a',
      sourceKind: MemorySourceKind.SessionSummary,
      title: 'Session summary',
      content: 'Copied conversation history',
      kind: MemoryKind.SessionSummary,
    });
    repository.createLink({
      id: 'semantic-summary',
      memoryId: 2,
      projectId: 'project-a',
      scope: MemoryScope.Session,
      sessionId: 'session-b',
      sourceKind: MemorySourceKind.SessionSummary,
      title: 'Session summary',
      content: 'Semantic session memory (v1)',
      kind: MemoryKind.SessionSummary,
      metadata: {
        extractorVersion: 1,
        sourceMessageIds: ['message-a'],
        digest: {
          shouldSave: true,
          goal: { text: 'Goal' },
          currentState: { text: 'Done' },
        },
      },
    });

    expect(repository.listSessionSummaryBackfillRecords()).toEqual([
      expect.objectContaining({
        memory: expect.objectContaining({
          id: 'legacy-summary',
          summaryFormat: MemorySummaryFormat.Legacy,
        }),
      }),
    ]);
    expect(repository.getLink('semantic-summary')).toMatchObject({
      summaryFormat: MemorySummaryFormat.Semantic,
    });
  } finally {
    db.close();
  }
});

test('finds a pending operation by stable replacement link id', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);

  try {
    repository.enqueue(
      MemoryOutboxOperation.SessionSummary,
      { content: 'Semantic replacement' },
      'stable-link',
    );

    expect(
      repository.findPendingByLinkId('stable-link', MemoryOutboxOperation.SessionSummary),
    ).toMatchObject({ linkId: 'stable-link', operation: MemoryOutboxOperation.SessionSummary });
    expect(
      repository.findPendingByLinkId('missing-link', MemoryOutboxOperation.SessionSummary),
    ).toBeNull();
  } finally {
    db.close();
  }
});

test('creates the link and outbox schema without importing the memory kernel database', () => {
  const exec = vi.fn();

  new MemoryRepository({ exec } as never);

  const schema = exec.mock.calls[0][0] as string;
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_links');
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_outbox');
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_candidates');
  expect(schema).toContain('CREATE TABLE IF NOT EXISTS memory_import_rejections');
  expect(schema).toContain('project_root TEXT');
  expect(schema).toContain("scope TEXT NOT NULL DEFAULT 'personal'");
  expect(schema).toContain('superseded_by TEXT');
  expect(schema).toContain('promoted_from_link_id TEXT');
  expect(schema).toContain('promotion_source_project_id TEXT');
  expect(schema).toContain('promotion_source_session_id TEXT');
  expect(schema).toContain('sensitivity TEXT');
  expect(schema).toContain('idx_memory_outbox_pending');
});

test('adds promotion provenance columns to an existing projection database', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE memory_candidates (id TEXT PRIMARY KEY);
    CREATE TABLE memory_outbox (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      available_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  try {
    new MemoryRepository(db);
    const columnNames = (table: string) =>
      new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          column => column.name,
        ),
      );
    const linkColumns = columnNames('memory_links');
    const candidateColumns = columnNames('memory_candidates');
    const promotionColumns = [
      'promoted_from_link_id',
      'promotion_source_project_id',
      'promotion_source_session_id',
    ];

    expect(promotionColumns.every(column => linkColumns.has(column))).toBe(true);
    expect(promotionColumns.every(column => candidateColumns.has(column))).toBe(true);
  } finally {
    db.close();
  }
});

test('persists promotion provenance on candidates and confirmed links', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);

  try {
    const candidateId = repository.createPersonalCandidate({
      id: 'candidate-promoted',
      projectId: 'personal://zhiyuan-agent/user',
      projectRoot: 'C:/personal-memory',
      scope: MemoryScope.Personal,
      sessionId: 'session-a',
      sourceKind: MemorySourceKind.ModelProposal,
      title: 'Promoted preference',
      content: 'Use SQLite for local state.',
      kind: MemoryKind.Preference,
      promotedFromLinkId: 'project-source',
      promotionSourceProjectId: 'project-a',
      promotionSourceSessionId: 'session-a',
    });

    expect(repository.getCandidate(candidateId)).toMatchObject({
      promotedFromLinkId: 'project-source',
      promotionSourceProjectId: 'project-a',
      promotionSourceSessionId: 'session-a',
    });
    expect(repository.getCandidateDetails(candidateId)).toMatchObject({
      promotedFromLinkId: 'project-source',
      promotionSourceProjectId: 'project-a',
      promotionSourceSessionId: 'session-a',
    });

    repository.createLink({
      id: candidateId,
      memoryId: 42,
      projectId: 'personal://zhiyuan-agent/user',
      scope: MemoryScope.Personal,
      sessionId: `${PERSONAL_MEMORY_SESSION_PREFIX}session-a`,
      sourceKind: MemorySourceKind.ModelProposal,
      title: 'Promoted preference',
      content: 'Use SQLite for local state.',
      kind: MemoryKind.Preference,
      promotedFromLinkId: 'project-source',
      promotionSourceProjectId: 'project-a',
      promotionSourceSessionId: 'session-a',
    });

    expect(repository.getLink(candidateId)).toMatchObject({
      promotedFromLinkId: 'project-source',
      promotionSourceProjectId: 'project-a',
      promotionSourceSessionId: 'session-a',
    });
  } finally {
    db.close();
  }
});

test('reads local metadata for a confirmed memory link', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);

  try {
    repository.createLink({
      id: 'session-summary',
      memoryId: 7,
      projectId: 'project-a',
      scope: MemoryScope.Session,
      sessionId: 'session-a',
      sourceKind: MemorySourceKind.SessionSummary,
      title: 'Session summary',
      content: 'Semantic session memory (v1)',
      kind: MemoryKind.SessionSummary,
      metadata: { extractorVersion: 1, sourceMessageIds: ['message-a'] },
    });

    expect(repository.getLinkMetadata('session-summary')).toEqual({
      extractorVersion: 1,
      sourceMessageIds: ['message-a'],
    });
  } finally {
    db.close();
  }
});

test('keeps manually added Personal memories recallable without extractor metadata', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);

  try {
    repository.createLink({
      id: 'manual-personal-link',
      memoryId: 9,
      projectId: 'personal://zhiyuan-agent/user',
      scope: MemoryScope.Personal,
      sessionId: 'personal:settings-memory',
      sourceKind: MemorySourceKind.Explicit,
      title: 'Email address',
      content: 'user@example.com',
      kind: MemoryKind.Preference,
      metadata: { manual: true },
    });

    expect(
      repository.filterRecallableMemoryIds({
        projectId: 'personal://zhiyuan-agent/user',
        memoryIds: [9],
        scope: MemoryScope.Personal,
      }),
    ).toEqual(new Set([9]));
    expect(
      repository.isCurrentSemanticMemoryLink('manual-personal-link', MemoryScope.Personal),
    ).toBe(true);
  } finally {
    db.close();
  }
});

test('deleting a candidate also cancels its pending outbox delivery', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);

  try {
    const candidateId = repository.createPersonalCandidate({
      id: 'pending-candidate',
      sessionId: 'settings-memory',
      sourceKind: MemorySourceKind.Explicit,
      title: 'Editor preference',
      content: 'Use compact tables.',
      kind: MemoryKind.Preference,
    });
    repository.enqueue(MemoryOutboxOperation.Confirm, { linkId: candidateId }, candidateId);

    expect(repository.listPending()).toHaveLength(1);
    repository.deleteCandidate(candidateId);

    expect(repository.getCandidate(candidateId)).toBeNull();
    expect(repository.listPending()).toHaveLength(0);
  } finally {
    db.close();
  }
});

test('rejecting an imported candidate leaves a content-free durable receipt', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);

  try {
    const candidateId = repository.createPersonalCandidate({
      id: 'legacy-memory:rejected',
      sessionId: 'legacy-memory-file',
      sourceKind: MemorySourceKind.LegacyFileImport,
      title: 'Legacy preference',
      content: 'Prefer concise answers.',
      kind: MemoryKind.Preference,
    });
    repository.enqueue(MemoryOutboxOperation.Confirm, { linkId: candidateId }, candidateId);

    repository.rejectCandidate(candidateId);

    expect(repository.getCandidate(candidateId)).toBeNull();
    expect(repository.hasImportRejection(candidateId)).toBe(true);
    expect(repository.listPending()).toHaveLength(0);
  } finally {
    db.close();
  }
});

test('finds confirmed Personal memories by their prefixed origin session', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);

  try {
    repository.createLink({
      id: 'personal-link',
      memoryId: 8,
      projectId: 'personal://zhiyuan-agent/user',
      scope: MemoryScope.Personal,
      sessionId: 'personal:session-a',
      sourceKind: MemorySourceKind.ModelProposal,
      title: 'Editor preference',
      content: 'Copied conversation text.',
      kind: MemoryKind.Preference,
    });

    expect(repository.listMigrationRecordsForContext('project-a')).toEqual([
      expect.objectContaining({
        storageKind: MemoryRecordStorageKind.Link,
        memory: expect.objectContaining({ id: 'personal-link' }),
      }),
    ]);
  } finally {
    db.close();
  }
});

test('authorizes recall against projected scope, session, and lifecycle state', () => {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);
  const createLink = (
    memoryId: number,
    scope: MemoryScope,
    sessionId: string,
    expiresAt?: string,
  ) =>
    repository.createLink({
      id: `link-${memoryId}`,
      memoryId,
      projectId: 'project-a',
      scope,
      sessionId,
      sourceKind:
        scope === MemoryScope.Session ? MemorySourceKind.SessionSummary : MemorySourceKind.Explicit,
      title: `Memory ${memoryId}`,
      content: `Content ${memoryId}`,
      kind: scope === MemoryScope.Session ? MemoryKind.SessionSummary : MemoryKind.Decision,
      expiresAt,
      metadata:
        scope === MemoryScope.Session
          ? {
              extractorVersion: 1,
              sourceMessageIds: ['message-a'],
              digest: {
                shouldSave: true,
                goal: { text: 'Goal', evidenceMessageIds: ['message-a'] },
                currentState: { text: 'Done', evidenceMessageIds: ['message-a'] },
              },
            }
          : {
              extractorKind: MemoryExtractorKind.Atomic,
              extractorVersion: 1,
            },
    });

  try {
    createLink(1, MemoryScope.Project, 'session-origin');
    createLink(2, MemoryScope.Session, 'session-a');
    createLink(3, MemoryScope.Session, 'session-b');
    const archivedLinkId = createLink(4, MemoryScope.Project, 'session-origin');
    createLink(5, MemoryScope.Project, 'session-origin', '2000-01-01T00:00:00.000Z');
    repository.createLink({
      id: 'legacy-session-summary',
      memoryId: 6,
      projectId: 'project-a',
      scope: MemoryScope.Session,
      sessionId: 'session-a',
      sourceKind: MemorySourceKind.SessionSummary,
      title: 'Session summary',
      content: 'Session objective: copied transcript',
      kind: MemoryKind.SessionSummary,
    });
    repository.createLink({
      id: 'legacy-project-memory',
      memoryId: 7,
      projectId: 'project-a',
      scope: MemoryScope.Project,
      sessionId: 'session-origin',
      sourceKind: MemorySourceKind.Explicit,
      title: 'Legacy project memory',
      content: 'Copied final answer.',
      kind: MemoryKind.Decision,
    });
    repository.setLinkStatus(archivedLinkId, MemoryLifecycleStatus.Archived);
    const memoryIds = [1, 2, 3, 4, 5, 6, 7];

    expect(
      repository.filterRecallableMemoryIds({
        projectId: 'project-a',
        memoryIds,
        scope: MemoryScope.Project,
      }),
    ).toEqual(new Set([1]));
    expect(
      repository.filterRecallableMemoryIds({
        projectId: 'project-a',
        memoryIds,
        scope: MemoryScope.Session,
        sessionId: 'session-a',
      }),
    ).toEqual(new Set([2]));
    expect(
      repository.filterRecallableMemoryIds({
        projectId: 'project-a',
        memoryIds,
        scope: MemoryScope.Session,
        sessionId: 'session-b',
      }),
    ).toEqual(new Set([3]));
    expect(
      repository.filterRecallableMemoryIds({
        projectId: 'project-a',
        memoryIds,
        scope: MemoryScope.Session,
      }),
    ).toEqual(new Set());
  } finally {
    db.close();
  }
});
