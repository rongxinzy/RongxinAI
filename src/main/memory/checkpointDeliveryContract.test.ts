import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vitest';

import { EngramMemoryScope, EngramObservationType, MemoryOutboxStatus } from './constants';
import { ProjectMemoryService } from './projectMemoryService';
import { MemoryRepository } from './repository';
import { recordSessionCheckpoint } from './sessionCheckpointService';
import { ZhiYuanEngramAdapter } from './zhiyuanEngramAdapter';

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
});

test('operation id survives a lost response, failed recovery and process restart', async () => {
  const operationIds: string[] = [];
  const resultIds: string[] = [];
  let recoveryAttempts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/sessions') return jsonResponse({ id: 'session-1' });
      if (init?.method === 'POST') {
        operationIds.push(JSON.parse(String(init.body)).operation_id);
        throw new Error('socket timeout');
      }
      resultIds.push(parsed.searchParams.get('operation_id') ?? '');
      recoveryAttempts += 1;
      if (recoveryAttempts === 1) throw new Error('network unavailable');
      return jsonResponse({ id: 17, status: 'committed' });
    }),
  );
  const manager = {
    getConnection: () => ({ url: 'http://127.0.0.1:4000', token: 'token' }),
    start: vi.fn(),
  } as never;
  const adapter = new ZhiYuanEngramAdapter(manager);
  const input = {
    sessionId: 'session-1',
    project: 'project-a',
    scope: EngramMemoryScope.Project,
    type: EngramObservationType.Decision,
    title: 'title',
    content: 'content',
    operationId: 'link-stable-1',
  };

  await expect(adapter.confirmMemory(adapter.saveCandidate(input), '/work')).rejects.toThrow(
    'network unavailable',
  );
  const restarted = new ZhiYuanEngramAdapter(manager);
  await expect(restarted.confirmMemory(restarted.saveCandidate(input), '/work')).resolves.toBe(17);
  expect(operationIds).toEqual(['link-stable-1', 'link-stable-1']);
  expect(resultIds).toEqual(['link-stable-1', 'link-stable-1']);
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
