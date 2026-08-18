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
  WorkbenchApprovalDecision,
  WorkbenchApprovalEffectStatus,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  WorkbenchVerificationOutcome,
} from '../../shared/workbenchTask';
import {
  MemoryRecordStorageKind,
  MemoryExtractorKind,
  PERSONAL_MEMORY_SESSION_PREFIX,
  SemanticMemoryMigrationStatus,
} from './constants';
import { LegacyMemoryMigrationService } from './legacyMemoryMigrationService';

const messages = [
  {
    id: 'user-1',
    type: 'user',
    content: 'Use SQLite for durable local state.',
    timestamp: 1,
  },
  {
    id: 'assistant-1',
    type: 'assistant',
    content: 'Implemented SQLite persistence and verified the tests.',
    timestamp: 2,
  },
];

const extractedMemory = {
  title: 'Durable project store',
  content: 'Use SQLite for durable local state.',
  kind: MemoryKind.Decision,
  importance: 0.8,
  confidence: 0.95,
  sensitivity: MemorySensitivity.Normal,
  evidenceSourceIds: ['user-1', 'assistant-1'],
};

function legacyRecord(
  overrides: Record<string, unknown> = {},
  storageKind = MemoryRecordStorageKind.Link,
) {
  return {
    storageKind,
    metadata: {},
    supersedesLinkId: null,
    promotedFromLinkId: null,
    memory: {
      id: 'legacy-1',
      memoryId: 7,
      projectId: 'project-a',
      scope: MemoryScope.Project,
      sessionId: 'session-1',
      sourceKind: MemorySourceKind.Explicit,
      taskId: null,
      runId: null,
      artifactId: null,
      approvalId: null,
      status:
        storageKind === MemoryRecordStorageKind.Link
          ? MemoryLifecycleStatus.Active
          : MemoryLifecycleStatus.NeedsReview,
      title: 'Copied result',
      content: 'LEGACY_TRANSCRIPT_COPY',
      kind: MemoryKind.Decision,
      topicKey: 'storage',
      importance: 0.5,
      confidence: 0.5,
      sensitivity: MemorySensitivity.Normal,
      expiresAt: null,
      supersededBy: null,
      promotedFromLinkId: null,
      promotionSourceProjectId: null,
      promotionSourceSessionId: null,
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
      deliveryStatus: null,
      deliveryError: null,
      ...overrides,
    },
  };
}

function fixture(records: unknown[], taskDetail: unknown = null) {
  const service = {
    listMigrationRecordsForContext: vi.fn(() => records),
    saveProjectMemory: vi.fn(async () => 42),
    proposePersonalMemory: vi.fn(() => 'candidate-new'),
    proposeProjectMemoryCandidate: vi.fn(() => 'candidate-project-new'),
    updateMigrationRecordMetadata: vi.fn(),
    deleteMigrationCandidate: vi.fn(),
    archiveMemory: vi.fn(),
  };
  const extractor = {
    extract: vi.fn(async () => ({
      memories: [extractedMemory],
      metadataFor: vi.fn(() => ({
        extractorKind: MemoryExtractorKind.Atomic,
        extractorVersion: 1,
        sourceIds: extractedMemory.evidenceSourceIds,
        digest: extractedMemory,
      })),
    })),
  };
  const getSession = vi.fn(() => ({ cwd: '/workspace/project', messages }));
  const migration = new LegacyMemoryMigrationService(
    service as never,
    { getSession } as never,
    { getDetail: vi.fn(() => taskDetail) } as never,
    extractor as never,
  );
  return { migration, service, extractor, getSession };
}

test('rebuilds legacy Project memory from canonical messages and supersedes the old link', async () => {
  const record = legacyRecord();
  const { migration, service, extractor } = fixture([record]);

  await expect(
    migration.migrateSession({
      sessionId: 'session-1',
      workingDirectory: '/workspace/project',
      complete: vi.fn(),
    }),
  ).resolves.toMatchObject({ migrated: 1 });

  const extractionInput = extractor.extract.mock.calls[0][0];
  expect(extractionInput.sources).toEqual([
    expect.objectContaining({ id: 'user-1' }),
    expect.objectContaining({ id: 'assistant-1' }),
  ]);
  expect(JSON.stringify(extractionInput.sources)).not.toContain('LEGACY_TRANSCRIPT_COPY');
  expect(extractionInput.requestedMemory.content).toBe('LEGACY_TRANSCRIPT_COPY');
  expect(service.saveProjectMemory).toHaveBeenCalledWith(
    expect.objectContaining({
      title: extractedMemory.title,
      content: extractedMemory.content,
      supersedesLinkId: 'legacy-1',
      metadata: expect.objectContaining({
        semanticMigration: expect.objectContaining({ legacyRecordId: 'legacy-1' }),
      }),
    }),
  );
});

test('keeps confirmed Personal memory active until its semantic replacement is reviewed', async () => {
  const record = legacyRecord({
    projectId: PERSONAL_MEMORY_PROJECT_ID,
    scope: MemoryScope.Personal,
    kind: MemoryKind.Preference,
    sessionId: `${PERSONAL_MEMORY_SESSION_PREFIX}session-1`,
  });
  const { migration, service, getSession } = fixture([record]);

  await expect(
    migration.migrateSession({
      sessionId: 'session-1',
      workingDirectory: '/workspace/project',
      complete: vi.fn(),
    }),
  ).resolves.toMatchObject({ pendingReview: 1 });

  expect(service.proposePersonalMemory).toHaveBeenCalledWith(
    expect.objectContaining({ supersedesLinkId: 'legacy-1' }),
  );
  expect(service.updateMigrationRecordMetadata).toHaveBeenCalledWith(
    record,
    expect.objectContaining({
      semanticMigration: expect.objectContaining({
        status: SemanticMemoryMigrationStatus.PendingReview,
        replacementCandidateIds: ['candidate-new'],
      }),
    }),
  );
  expect(service.archiveMemory).not.toHaveBeenCalled();
  expect(getSession).toHaveBeenCalledWith('session-1', null);
});

test('replaces an unreviewed legacy candidate instead of confirming it implicitly', async () => {
  const record = legacyRecord(
    {
      taskId: 'task-1',
      runId: 'run-1',
      sourceKind: MemorySourceKind.TaskVerifier,
    },
    MemoryRecordStorageKind.Candidate,
  );
  const { migration, service, extractor } = fixture([record], {
    task: { id: 'task-1', goal: 'Persist workspace state.' },
    runs: [
      {
        id: 'run-1',
        verificationResult: {
          outcome: WorkbenchVerificationOutcome.Passed,
          summary: 'Persistence tests passed.',
        },
      },
    ],
    artifacts: [
      {
        id: 'artifact-1',
        runId: 'run-1',
        verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
        reference: 'src/store.ts',
        contentHash: 'sha256:abc',
        provenance: WorkbenchArtifactProvenance.Controller,
        metadata: {},
      },
    ],
    approvals: [
      {
        id: 'approval-1',
        runId: 'run-1',
        effectStatus: WorkbenchApprovalEffectStatus.Succeeded,
        toolName: 'write',
        decision: WorkbenchApprovalDecision.Approved,
      },
    ],
  });

  await migration.migrateSession({
    sessionId: 'session-1',
    workingDirectory: '/workspace/project',
    complete: vi.fn(),
  });

  expect(service.proposeProjectMemoryCandidate).toHaveBeenCalledOnce();
  expect(service.deleteMigrationCandidate).toHaveBeenCalledWith('legacy-1');
  expect(service.saveProjectMemory).not.toHaveBeenCalled();
  expect(extractor.extract.mock.calls[0][0].sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'task:task-1:goal' }),
      expect.objectContaining({ id: 'run:run-1:verification' }),
      expect.objectContaining({ id: 'artifact:artifact-1' }),
      expect.objectContaining({ id: 'approval:approval-1' }),
    ]),
  );
});
