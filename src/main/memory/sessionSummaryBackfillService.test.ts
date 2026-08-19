import { expect, test, vi } from 'vitest';

import type { CoworkMessage } from '../coworkStore';
import { SESSION_SUMMARY_BACKFILL_VERSION, SessionSummaryBackfillStatus } from './constants';
import {
  buildSessionSummaryBackfillBatches,
  SessionSummaryBackfillService,
} from './sessionSummaryBackfillService';

function message(id: string, type: CoworkMessage['type'], content = id): CoworkMessage {
  return { id, type, content, timestamp: 1 };
}

function legacyRecord(metadata: Record<string, unknown> = {}) {
  return {
    memory: {
      id: 'legacy-link',
      sessionId: 'session-1',
    },
    storageKind: 'link',
    metadata,
    supersedesLinkId: null,
    promotedFromLinkId: null,
  };
}

test('partitions long histories into chronological conversation batches', () => {
  const messages = Array.from({ length: 8 }, (_, index) => [
    message(`user-${index}`, 'user'),
    message(`assistant-${index}`, 'assistant'),
  ]).flat();

  const batches = buildSessionSummaryBackfillBatches(messages);

  expect(batches).toHaveLength(2);
  expect(batches[0]).toHaveLength(12);
  expect(batches[1].map(item => item.id)).toEqual([
    'user-6',
    'assistant-6',
    'user-7',
    'assistant-7',
  ]);
});

test('folds raw history and writes a versioned semantic replacement', async () => {
  const record = legacyRecord();
  const updateMigrationRecordMetadata = vi.fn();
  const saveSessionSummary = vi.fn(async () => 42);
  const memoryService = {
    drainOutbox: vi.fn(async () => 0),
    listSessionSummaryBackfillRecords: vi.fn(() => [record]),
    updateMigrationRecordMetadata,
    saveSessionSummary,
  };
  const messages = Array.from({ length: 8 }, (_, index) => [
    message(`user-${index}`, 'user'),
    message(`assistant-${index}`, 'assistant'),
  ]).flat();
  const coworkStore = {
    getSession: vi.fn(() => ({ cwd: '/workspace', messages })),
  };
  const extract = vi
    .fn()
    .mockResolvedValueOnce({
      summary: 'first',
      metadata: { digest: { shouldSave: true }, sourceMessageIds: ['user-0'] },
    })
    .mockResolvedValueOnce({
      summary: 'final',
      metadata: { digest: { shouldSave: true }, sourceMessageIds: ['user-7'] },
    });
  const service = new SessionSummaryBackfillService(
    memoryService as never,
    coworkStore as never,
    { extract } as never,
  );

  await expect(service.run(vi.fn())).resolves.toEqual({
    completed: 1,
    deferred: 0,
    failed: 0,
    retained: 0,
  });

  expect(extract).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      previousMemory: {
        digest: { shouldSave: true },
        sourceMessageIds: ['user-0'],
      },
    }),
  );
  expect(saveSessionSummary).toHaveBeenCalledWith({
    sessionId: 'session-1',
    workingDirectory: '/workspace',
    summary: 'final',
    linkId: `session-summary-backfill:${SESSION_SUMMARY_BACKFILL_VERSION}:legacy-link`,
    metadata: {
      digest: { shouldSave: true },
      sourceMessageIds: ['user-7'],
      backfillVersion: SESSION_SUMMARY_BACKFILL_VERSION,
      migratedFromLinkId: 'legacy-link',
    },
  });
  expect(updateMigrationRecordMetadata).toHaveBeenLastCalledWith(
    record,
    expect.objectContaining({
      sessionSummaryBackfill: expect.objectContaining({
        status: SessionSummaryBackfillStatus.Completed,
      }),
    }),
  );
});

test('marks missing source history without calling the model', async () => {
  const record = legacyRecord();
  const updateMigrationRecordMetadata = vi.fn();
  const memoryService = {
    drainOutbox: vi.fn(async () => 0),
    listSessionSummaryBackfillRecords: vi.fn(() => [record]),
    updateMigrationRecordMetadata,
    saveSessionSummary: vi.fn(),
  };
  const extractor = { extract: vi.fn() };
  const service = new SessionSummaryBackfillService(
    memoryService as never,
    { getSession: vi.fn(() => null) } as never,
    extractor as never,
  );

  await expect(service.run(vi.fn())).resolves.toEqual({
    completed: 0,
    deferred: 0,
    failed: 0,
    retained: 1,
  });

  expect(extractor.extract).not.toHaveBeenCalled();
  expect(updateMigrationRecordMetadata).toHaveBeenCalledWith(
    record,
    expect.objectContaining({
      sessionSummaryBackfill: expect.objectContaining({
        status: SessionSummaryBackfillStatus.EvidenceUnavailable,
      }),
    }),
  );
});

test('coalesces concurrent backfill triggers into one serial run', async () => {
  let release: (() => void) | undefined;
  const listSessionSummaryBackfillRecords = vi.fn(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      }),
  );
  const memoryService = {
    drainOutbox: vi.fn(async () => 0),
    listSessionSummaryBackfillRecords: vi.fn(() => []),
  };
  memoryService.drainOutbox.mockImplementationOnce(async () => {
    await listSessionSummaryBackfillRecords();
    return 0;
  });
  const service = new SessionSummaryBackfillService(memoryService as never, {} as never);

  const first = service.run(vi.fn());
  const second = service.run(vi.fn());
  expect(first).toBe(second);
  release?.();
  await first;

  expect(memoryService.listSessionSummaryBackfillRecords).toHaveBeenCalledTimes(1);
});
