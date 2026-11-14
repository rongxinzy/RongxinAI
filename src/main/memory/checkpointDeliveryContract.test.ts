import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vitest';

import { MemoryBackendScope, MemoryObservationType, MemoryOutboxStatus } from './constants';
import { ProjectMemoryService } from './projectMemoryService';
import { MemoryRepository } from './repository';
import { recordSessionCheckpoint } from './sessionCheckpointService';
import { MarkdownMemoryBackend, markdownMemoryId } from './markdownMemoryBackend';
import { MarkdownMemoryRuntime } from './markdownMemoryRuntime';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

afterEach(() => vi.unstubAllGlobals());

test('offline commit is readable after restart and resumes delivery', async () => {
  const database = new Database(':memory:');
  const repository = new MemoryRepository(database);
  const offline = new ProjectMemoryService(
    repository,
    {
      saveCandidate: vi.fn(),
      confirmMemory: vi.fn(() => new Promise<null>(() => {})),
    } as never,
    cwd => ({ id: 'project-a', displayName: cwd, root: cwd }),
    '/personal',
  );
  const result = await recordSessionCheckpoint(
    offline,
    { sessionId: 'session-1', workingDirectory: '/work', runId: 'run-1', turnId: 'turn-1' },
    { goal: '生成 xlsx', accomplished: '创建并校验工作簿' },
  );

  expect(result).toEqual({ checkpointId: 'session-1:turn-1', syncState: 'pending' });
  expect(repository.getLink(result.checkpointId)).toBeNull();
  expect(repository.listPending()).toHaveLength(1);
  expect(
    offline.getActiveSessionSummary({ sessionId: 'session-1', workingDirectory: '/work' }),
  ).toMatchObject({ content: expect.stringContaining('生成 xlsx') });

  const recoveredRepository = new MemoryRepository(database);
  const recovered = new ProjectMemoryService(
    recoveredRepository,
    {
      saveCandidate: vi.fn((input: Record<string, unknown>) => ({ id: 'new-id', ...input })),
      confirmMemory: vi.fn(async () => 17),
    } as never,
    cwd => ({ id: 'project-a', displayName: cwd, root: cwd }),
    '/personal',
  );
  expect(
    recovered.getActiveSessionSummary({ sessionId: 'session-1', workingDirectory: '/work' }),
  ).toMatchObject({ content: expect.stringContaining('创建并校验工作簿') });

  await recovered.retryPendingOutbox();
  expect(recoveredRepository.getSessionCheckpoint(result.checkpointId)?.syncStatus).toBe(
    MemoryOutboxStatus.Completed,
  );
  expect(recoveredRepository.getLink(result.checkpointId)?.memoryId).toBe(17);
  await expect(
    recovered.saveSessionSummary({
      sessionId: 'session-1',
      workingDirectory: '/work',
      summary: 'changed by a replay must stay immutable',
      linkId: result.checkpointId,
    }),
  ).resolves.toEqual({ checkpointId: result.checkpointId, syncState: 'synced' });
});

test('a native Markdown commit survives an interrupted projection acknowledgement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'memory-ack-'));
  const db = new Database(':memory:');
  try {
    const repository = new MemoryRepository(db);
    const backend = new MarkdownMemoryBackend(new MarkdownMemoryRuntime(root), repository);
    const input = {
      sessionId: 'session-1',
      project: 'project-a',
      scope: MemoryBackendScope.Project,
      type: MemoryObservationType.Decision,
      title: 'title',
      content: 'content',
      operationId: 'link-stable-1',
    };
    await expect(
      backend.confirmMemory(backend.saveCandidate(input), '/work', () => {
        throw new Error('projection acknowledgement interrupted');
      }),
    ).rejects.toThrow('projection acknowledgement interrupted');
    const runtime = new MarkdownMemoryRuntime(root);
    const restarted = new MarkdownMemoryBackend(runtime, repository);
    expect(await restarted.confirmMemory(restarted.saveCandidate(input), '/work')).toBe(
      markdownMemoryId(input.operationId),
    );
    expect((await (await runtime.files(input.project)).read('memory')).entries).toHaveLength(1);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('checkpoint and outbox commit atomically', () => {
  const database = new Database(':memory:');
  const repository = new MemoryRepository(database);
  database.exec(`
    CREATE TRIGGER reject_checkpoint_outbox BEFORE INSERT ON memory_outbox
    BEGIN SELECT RAISE(ABORT, 'outbox rejected'); END;
  `);

  expect(() =>
    repository.saveSessionCheckpoint({
      id: 'checkpoint-atomic',
      sessionId: 'session-1',
      projectId: 'project-a',
      projectRoot: '/work',
      summary: 'content',
      expiresAt: '2026-12-01T00:00:00.000Z',
    }),
  ).toThrow('outbox rejected');
  expect(repository.getSessionCheckpoint('checkpoint-atomic')).toBeNull();
  expect(repository.listPending()).toHaveLength(0);
  expect(repository.maxSessionCheckpointSequence('session-1')).toBe(0);
});
