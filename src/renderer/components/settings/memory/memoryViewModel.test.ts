import { expect, test } from 'vitest';

import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySummaryFormat,
  MemorySourceKind,
  type ManagedMemoryRecord,
} from '../../../../shared/memory';
import {
  ManagedMemoryScopeFilter,
  ManagedMemoryStatusFilter,
  ManagedMemoryView,
} from './constants';
import {
  collectMemorySourceSessionIds,
  countManagedMemories,
  filterAndSortManagedMemories,
  isLegacySessionSummaryAwaitingUpgrade,
} from './memoryViewModel';
import { parseMemoryTimestamp } from '../../../../shared/memory/timestamps';

function record(id: string, overrides: Partial<ManagedMemoryRecord> = {}): ManagedMemoryRecord {
  return {
    id,
    memoryId: 1,
    projectId: 'project-a',
    scope: MemoryScope.Project,
    sessionId: 'session-a',
    sourceKind: MemorySourceKind.Explicit,
    taskId: null,
    runId: null,
    artifactId: null,
    approvalId: null,
    status: MemoryLifecycleStatus.Active,
    title: `Title ${id}`,
    content: `Content ${id}`,
    kind: MemoryKind.Decision,
    topicKey: null,
    importance: 0.8,
    confidence: 0.9,
    sensitivity: MemorySensitivity.Normal,
    expiresAt: null,
    supersededBy: null,
    promotedFromLinkId: null,
    promotionSourceProjectId: null,
    promotionSourceSessionId: null,
    createdAt: '2026-08-18T01:00:00.000Z',
    updatedAt: '2026-08-18T01:00:00.000Z',
    deliveryStatus: MemoryDeliveryStatus.Completed,
    deliveryError: null,
    ...overrides,
  };
}

test('separates long-term memories from session summaries', () => {
  const records = [record('project'), record('session', { scope: MemoryScope.Session })];

  expect(countManagedMemories(records)).toEqual({ longTerm: 1, session: 1 });
  expect(
    filterAndSortManagedMemories(records, {
      view: ManagedMemoryView.LongTerm,
      scope: ManagedMemoryScopeFilter.All,
      status: ManagedMemoryStatusFilter.All,
      query: '',
    }).map(item => item.id),
  ).toEqual(['project']);
  expect(
    filterAndSortManagedMemories(records, {
      view: ManagedMemoryView.Session,
      scope: ManagedMemoryScopeFilter.All,
      status: ManagedMemoryStatusFilter.All,
      query: '',
    }).map(item => item.id),
  ).toEqual(['session']);
});

test('collects current and promotion source session ids without duplicates', () => {
  expect(
    collectMemorySourceSessionIds([
      record('first', { sessionId: 'session-a' }),
      record('second', {
        sessionId: 'session-a',
        promotionSourceSessionId: 'session-b',
      }),
    ]),
  ).toEqual(['session-a', 'session-b']);
});

test('marks only active legacy session summaries as awaiting upgrade', () => {
  expect(
    isLegacySessionSummaryAwaitingUpgrade(
      record('legacy', {
        scope: MemoryScope.Session,
        summaryFormat: MemorySummaryFormat.Legacy,
      }),
    ),
  ).toBe(true);
  expect(
    isLegacySessionSummaryAwaitingUpgrade(
      record('semantic', {
        scope: MemoryScope.Session,
        summaryFormat: MemorySummaryFormat.Semantic,
      }),
    ),
  ).toBe(false);
  expect(
    isLegacySessionSummaryAwaitingUpgrade(
      record('superseded', {
        scope: MemoryScope.Session,
        status: MemoryLifecycleStatus.Superseded,
        summaryFormat: MemorySummaryFormat.Legacy,
      }),
    ),
  ).toBe(false);
});

test('filters by scope, lifecycle group, and searchable identifiers', () => {
  const records = [
    record('active-project'),
    record('archived-personal', {
      scope: MemoryScope.Personal,
      status: MemoryLifecycleStatus.Archived,
      taskId: 'task-searchable',
    }),
  ];

  expect(
    filterAndSortManagedMemories(records, {
      view: ManagedMemoryView.LongTerm,
      scope: ManagedMemoryScopeFilter.Personal,
      status: ManagedMemoryStatusFilter.Inactive,
      query: 'TASK-SEARCHABLE',
    }).map(item => item.id),
  ).toEqual(['archived-personal']);
});

test('prioritizes propagation issues, review candidates, then recent active memories', () => {
  const records = [
    record('older-active', { updatedAt: '2026-08-17T01:00:00.000Z' }),
    record('review', { status: MemoryLifecycleStatus.NeedsReview }),
    record('newer-active', { updatedAt: '2026-08-18T02:00:00.000Z' }),
    record('pending', { deliveryStatus: MemoryDeliveryStatus.Pending }),
  ];

  expect(
    filterAndSortManagedMemories(records, {
      view: ManagedMemoryView.LongTerm,
      scope: ManagedMemoryScopeFilter.All,
      status: ManagedMemoryStatusFilter.All,
      query: '',
    }).map(item => item.id),
  ).toEqual(['pending', 'review', 'newer-active', 'older-active']);
});

test('treats legacy SQLite timestamps as UTC when sorting', () => {
  expect(parseMemoryTimestamp('2026-09-09 11:14:18')).toBe(
    Date.parse('2026-09-09T11:14:18Z'),
  );
  expect(parseMemoryTimestamp('2026-09-09T11:14:18.684Z')).toBe(
    Date.parse('2026-09-09T11:14:18.684Z'),
  );
  expect(parseMemoryTimestamp('not-a-date')).toBeNaN();

  const records = [
    // Legacy format written by datetime('now'): 11:14:18 UTC, later than the
    // ISO-Z row's 11:10:34 UTC even though string comparison suggests otherwise.
    record('legacy-format', { updatedAt: '2026-09-09 11:14:18' }),
    record('iso-format', { updatedAt: '2026-09-09T11:10:34.000Z' }),
  ];

  expect(
    filterAndSortManagedMemories(records, {
      view: ManagedMemoryView.LongTerm,
      scope: ManagedMemoryScopeFilter.All,
      status: ManagedMemoryStatusFilter.All,
      query: '',
    }).map(item => item.id),
  ).toEqual(['legacy-format', 'iso-format']);
});

test('session view lists only the current summary of each session', () => {
  const records = [
    record('superseded', {
      scope: MemoryScope.Session,
      status: MemoryLifecycleStatus.Superseded,
    }),
    record('archived', {
      scope: MemoryScope.Session,
      status: MemoryLifecycleStatus.Archived,
    }),
    record('current', { scope: MemoryScope.Session }),
  ];

  expect(countManagedMemories(records)).toEqual({ longTerm: 0, session: 1 });
  expect(
    filterAndSortManagedMemories(records, {
      view: ManagedMemoryView.Session,
      scope: ManagedMemoryScopeFilter.All,
      status: ManagedMemoryStatusFilter.All,
      query: '',
    }).map(item => item.id),
  ).toEqual(['current']);
});
