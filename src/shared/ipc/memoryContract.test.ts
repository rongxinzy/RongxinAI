import { describe, expect, test } from 'vitest';

import { memoryContract } from './memoryContract';
import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
  MemorySummaryFormat,
} from '../memory/constants';

/**
 * Schema fidelity tests: fixtures below are copied from real renderer call
 * sites (services/memory.ts, MemorySettingsView manual curation form) so a
 * schema drift that would reject a valid production invoke fails here, and
 * representative bad inputs are proven rejected.
 */

/** Full `ManagedMemoryRecord` projection the memory settings view renders. */
const record = {
  id: 'link-1',
  memoryId: 42,
  projectId: 'workspace-abc',
  scope: MemoryScope.Project,
  sessionId: 's-1',
  sourceKind: MemorySourceKind.Explicit,
  taskId: 'task-1',
  runId: 'run-1',
  artifactId: null,
  approvalId: null,
  status: MemoryLifecycleStatus.Active,
  title: 'Use Bun for scripts',
  content: 'All repo scripts must run through Bun, never npm.',
  kind: MemoryKind.Decision,
  topicKey: null,
  importance: 3,
  confidence: 0.9,
  sensitivity: MemorySensitivity.Normal,
  expiresAt: null,
  supersededBy: null,
  promotedFromLinkId: null,
  promotionSourceProjectId: null,
  promotionSourceSessionId: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  deliveryStatus: MemoryDeliveryStatus.Completed,
  deliveryError: null,
  summaryFormat: MemorySummaryFormat.Semantic,
};

describe('memory contract args', () => {
  test('list accepts the optional filter input memoryService sends', () => {
    // memoryService.list(input = {}) and scoped variants
    expect(memoryContract.list.args.safeParse([{}]).success).toBe(true);
    expect(
      memoryContract.list.args.safeParse([
        { workingDirectory: '/repo', scope: MemoryScope.Personal, query: 'bun' },
      ]).success,
    ).toBe(true);
    expect(memoryContract.list.args.safeParse([]).success).toBe(true);
    expect(memoryContract.list.args.safeParse([{ scope: 'global' }]).success).toBe(false);
  });

  test('createManual accepts the curation form payload', () => {
    expect(
      memoryContract.createManual.args.safeParse([
        {
          workingDirectory: '/repo',
          scope: MemoryScope.Personal,
          title: 'Prefer concise replies',
          content: 'Keep answers short.',
          kind: MemoryKind.Preference,
          sensitivity: MemorySensitivity.Sensitive,
        },
      ]).success,
    ).toBe(true);
    // Manual curation is decision/preference only — session_summary is reserved
    // for the automatic session-summarizer.
    expect(
      memoryContract.createManual.args.safeParse([
        {
          workingDirectory: '/repo',
          scope: MemoryScope.Personal,
          title: 't',
          content: 'c',
          kind: MemoryKind.SessionSummary,
          sensitivity: MemorySensitivity.Normal,
        },
      ]).success,
    ).toBe(false);
    // Session scope is not a valid manual target (project/personal only).
    expect(
      memoryContract.createManual.args.safeParse([
        {
          workingDirectory: '/repo',
          scope: MemoryScope.Session,
          title: 't',
          content: 'c',
          kind: MemoryKind.Decision,
          sensitivity: MemorySensitivity.Normal,
        },
      ]).success,
    ).toBe(false);
  });

  test('updateManual carries the record id and edited fields', () => {
    expect(
      memoryContract.updateManual.args.safeParse([
        {
          id: 'link-1',
          workingDirectory: '/repo',
          title: 'Use Bun for everything',
          content: 'Scripts and installs go through Bun.',
          kind: MemoryKind.Decision,
          sensitivity: MemorySensitivity.Normal,
        },
      ]).success,
    ).toBe(true);
    expect(memoryContract.updateManual.args.safeParse([{ id: 'link-1' }]).success).toBe(false);
  });

  test('scalar-arg helpers match memoryService call shapes', () => {
    expect(memoryContract.confirmCandidate.args.safeParse(['cand-1']).success).toBe(true);
    expect(memoryContract.archive.args.safeParse(['link-1']).success).toBe(true);
    expect(memoryContract.restore.args.safeParse(['link-1']).success).toBe(true);
    expect(memoryContract.forget.args.safeParse(['link-1', true]).success).toBe(true);
    expect(memoryContract.forget.args.safeParse(['link-1']).success).toBe(false);
    expect(
      memoryContract.resolveSessionTitles.args.safeParse([{ sessionIds: ['s-1'] }]).success,
    ).toBe(true);
  });
});

describe('memory contract results', () => {
  test('list envelope accepts real records including legacy rows', () => {
    expect(memoryContract.list.result.safeParse({ success: true, data: [record] }).success).toBe(
      true,
    );
    // Legacy imports: session_summary kind, legacy source, null summaryFormat.
    expect(
      memoryContract.list.result.safeParse({
        success: true,
        data: [
          {
            ...record,
            kind: MemoryKind.SessionSummary,
            sourceKind: MemorySourceKind.LegacyFileImport,
            summaryFormat: null,
          },
        ],
      }).success,
    ).toBe(true);
    expect(memoryContract.list.result.safeParse({ success: false, error: 'db busy' }).success).toBe(
      true,
    );
  });

  test('record rows with an unknown source kind are rejected', () => {
    expect(
      memoryContract.list.result.safeParse({
        success: true,
        data: [{ ...record, sourceKind: 'magic' }],
      }).success,
    ).toBe(false);
  });

  test('void/number helpers accept their envelope shapes', () => {
    expect(
      memoryContract.archive.result.safeParse({ success: true, data: undefined }).success,
    ).toBe(true);
    expect(memoryContract.drainOutbox.result.safeParse({ success: true, data: 3 }).success).toBe(
      true,
    );
    expect(memoryContract.forget.result.safeParse({ success: true, data: true }).success).toBe(
      true,
    );
  });
});
