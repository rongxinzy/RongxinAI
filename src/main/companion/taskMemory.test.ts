import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { MemoryKind, MemoryScope, MemoryLifecycleStatus } from '../../shared/memory';
import { EngramManager } from '../memory/engramManager';
import { MemoryRepository } from '../memory/repository';
import { ProjectMemoryService } from '../memory/projectMemoryService';
import { resolveProjectIdentity } from '../memory/projectIdentity';
import { ZhiYuanEngramAdapter } from '../memory/zhiyuanEngramAdapter';
import { buildPiProjectMemoryTool } from '../memory/piMemoryTool';
import { PiMemoryAction, MemoryRecordStorageKind } from '../memory/constants';
import { CompanionMemoryService, companionMemoryIdentity } from './memory';
import { CompanionMemoryRetractions } from './memoryRetractions';
import { companionTaskMemoryResolver } from './taskMemoryIdentity';
import { SessionSummaryService } from '../memory/sessionSummaryService';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-task-memory-'));
  const db = new Database(path.join(root, 'state.sqlite'));
  const manager = new EngramManager({ userDataPath: root, projectRoot: process.cwd() });
  const adapter = new ZhiYuanEngramAdapter(manager);
  const repository = new MemoryRepository(db);
  const directory = path.join(root, 'companions');
  const service = new ProjectMemoryService(
    repository,
    adapter,
    resolveProjectIdentity,
    path.join(root, 'personal'),
    companionTaskMemoryResolver(db, directory),
  );
  const privateMemory = new CompanionMemoryService(
    repository,
    adapter,
    service,
    directory,
    new CompanionMemoryRetractions(db),
  );
  const a = randomUUID(),
    b = randomUUID();
  for (const [petId, session] of [
    [a, 'a-task'],
    [a, 'a-next'],
    [b, 'b-task'],
  ]) {
    db.prepare('INSERT INTO companion_task_admissions VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      petId,
      session,
      'fingerprint',
      session,
      `task-${session}`,
      `run-${session}`,
      1,
    );
  }
  const tool = (sessionId: string) =>
    buildPiProjectMemoryTool({
      service,
      sessionId,
      workingDirectory: root,
      getMessages: () => [],
      complete: async () => {
        throw new Error('Explicit memory actions must not request a model');
      },
    }) as {
      execute: (
        id: string,
        params: Record<string, unknown>,
      ) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
    };
  const context = (sessionId: string, query = 'paper kite') =>
    service.buildProjectContext({
      workingDirectory: root,
      sessionId,
      query,
    });
  return {
    root,
    db,
    adapter,
    repository,
    service,
    privateMemory,
    a,
    b,
    tool,
    context,
    cleanup: async () => {
      await manager.stop();
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test('chat and task facts use the admitted companion namespace; ordinary workbench remains separate', async () => {
  const f = await fixture();
  try {
    await f.privateMemory.save({
      petId: f.a,
      requestId: 'chat',
      kind: MemoryKind.Preference,
      title: 'Paper kite',
      content: 'My paper kite is blue.',
    });
    expect(await f.context('a-task')).toContain('is blue');
    expect(await f.context('a-next')).toContain('is blue');
    expect(await f.context('b-task')).toBe('');
    expect(await f.context('ordinary')).toBe('');
    const result = await f.tool('a-task').execute('call-save', {
      action: PiMemoryAction.Save,
      kind: MemoryKind.Decision,
      title: 'Paper kite frame',
      content: 'Use a bamboo frame for the paper kite.',
      topicKey: 'kite-frame',
      sessionId: 'b-task',
      petId: f.b,
    });
    expect(result.details.memoryId).toEqual(expect.any(Number));
    const saved = f.repository.findLinkByMemoryId(result.details.memoryId as number)!;
    expect(saved).toMatchObject({
      scope: MemoryScope.Companion,
      projectId: companionMemoryIdentity(f.a).projectId,
      sessionId: 'a-task',
    });
    expect(await f.privateMemory.context(f.a, 'paper kite')).toContain('bamboo');
    expect(await f.context('a-next')).toContain('bamboo');
    expect(await f.context('b-task')).toBe('');
    expect(await f.context('ordinary')).toBe('');
    expect(
      (
        await f
          .tool('b-task')
          .execute('recall', { action: PiMemoryAction.Recall, query: 'paper kite' })
      ).details.count,
    ).toBe(0);
    expect(
      (
        await f
          .tool('a-next')
          .execute('recall', { action: PiMemoryAction.Recall, query: 'paper kite' })
      ).details.count,
    ).toBe(2);
    expect(
      f.service.getRecallableMemoryById({
        workingDirectory: f.root,
        sessionId: 'b-task',
        memoryId: saved.memoryId!,
      }),
    ).toBeNull();
    await f.privateMemory.forget(f.a, saved.id);
    expect(await f.context('a-next')).not.toContain('bamboo');
    await f.tool('ordinary').execute('save-project', {
      action: PiMemoryAction.Save,
      title: 'Paper kite workspace',
      content: 'The workspace stores paper kite drawings.',
    });
    expect(await f.context('ordinary')).toContain('drawings');
    expect(await f.context('a-task')).not.toContain('drawings');
    expect(f.service.listManagedMemories().map(memory => memory.scope)).toEqual([
      MemoryScope.Project,
    ]);
  } finally {
    await f.cleanup();
  }
}, 60_000);

test('task summaries stay private to the exact session, including global memory management', async () => {
  const f = await fixture();
  try {
    const summary = new SessionSummaryService(f.service, {
      getSession: () => ({
        messages: [
          { id: 'u1', type: 'user', content: 'Build the paper kite.', timestamp: 1 },
          { id: 'a1', type: 'assistant', content: 'The paper kite frame is ready.', timestamp: 2 },
        ],
      }),
    } as never);
    const memoryId = await summary.rollup({
      sessionId: 'a-task',
      workingDirectory: f.root,
      complete: async () =>
        JSON.stringify({
          shouldSave: true,
          goal: { text: 'Build the paper kite.', evidenceMessageIds: ['u1'] },
          currentState: { text: 'The paper kite frame is ready.', evidenceMessageIds: ['a1'] },
          decisions: [],
          artifacts: [],
          unresolved: [],
          nextSteps: [],
        }),
    });
    expect(memoryId).toEqual(expect.any(Number));
    const stored = f.repository.findLinkByMemoryId(memoryId!)!;
    expect(stored).toMatchObject({
      scope: MemoryScope.Session,
      projectId: companionMemoryIdentity(f.a).projectId,
    });
    expect(await f.context('a-task')).toContain('frame is ready');
    expect(await f.context('a-next')).toBe('');
    expect(await f.context('b-task')).toBe('');
    expect(await f.context('ordinary')).toBe('');
    expect(f.service.listManagedMemories()).toEqual([]);
    expect(f.service.listManagedMemories({ workingDirectory: f.root })).toEqual([]);
    expect(
      f.service.getActiveSessionSummary({ sessionId: 'a-task', workingDirectory: f.root })?.content,
    ).toContain('frame is ready');
    f.repository.updateMigrationRecordMetadata(stored.id, MemoryRecordStorageKind.Link, {});
    expect(f.repository.listSessionSummaryBackfillRecords()).toHaveLength(1);
    expect(f.service.listSessionSummaryBackfillRecords()).toEqual([]);
  } finally {
    await f.cleanup();
  }
}, 60_000);

test('task proposals remain private and personal promotions require owner provenance and user confirmation', async () => {
  const f = await fixture();
  try {
    const id = f.service.proposeProjectMemoryCandidate({
      sessionId: 'a-task',
      workingDirectory: f.root,
      type: MemoryKind.Decision,
      title: 'Paper kite',
      content: 'The paper kite uses bamboo.',
      taskId: 'task-a-task',
      runId: 'run-a-task',
      metadata: { source: 'explicit_user_request' },
    });
    expect(f.repository.getCandidate(id)).toMatchObject({
      scope: MemoryScope.Companion,
      projectId: companionMemoryIdentity(f.a).projectId,
      status: MemoryLifecycleStatus.NeedsReview,
    });
    expect(f.service.listManagedMemories()).toEqual([]);
    expect(await f.context('a-task')).toBe('');
    // Existing candidate confirmation remains the authority; extraction alone cannot share.
    const observation = await f.service.confirmMemoryCandidate(id);
    expect(observation).toEqual(expect.any(Number));
    expect(await f.context('b-task')).toBe('');
    const wrong = await f.tool('b-task').execute('cross-share', {
      action: PiMemoryAction.ProposePersonal,
      title: 'Paper kite',
      content: 'The paper kite uses bamboo.',
      promotesMemoryId: observation,
    });
    expect(wrong.details.isError).toBe(true);
    const proposed = await f.tool('a-task').execute('share', {
      action: PiMemoryAction.ProposePersonal,
      title: 'Paper kite',
      content: 'The paper kite uses bamboo.',
      promotesMemoryId: observation,
    });
    expect(proposed.details.needsReview).toBe(true);
    expect(await f.context('b-task')).toBe('');
    await f.service.confirmPersonalCandidate(proposed.details.candidateId as string);
    expect(await f.context('b-task')).toContain('bamboo');
    expect(await f.context('ordinary')).toContain('bamboo');
  } finally {
    await f.cleanup();
  }
}, 60_000);

test('offline private task writes remain visible and can be withdrawn before retry', async () => {
  const f = await fixture();
  try {
    vi.spyOn(f.adapter, 'confirmMemory').mockResolvedValueOnce(null);
    const result = await f.tool('a-task').execute('offline', {
      action: PiMemoryAction.Save,
      title: 'Paper kite',
      content: 'The paper kite is offline.',
    });
    expect(result.details.queued).toBe(true);
    const [pending] = f.privateMemory.list(f.a);
    expect(pending.memoryId).toBeNull();
    expect(f.privateMemory.list(f.b)).toEqual([]);
    expect(f.service.listManagedMemories()).toEqual([]);
    await f.privateMemory.forget(f.a, pending.id);
    await f.service.retryPendingOutbox();
    expect(f.privateMemory.list(f.a)).toEqual([]);
    expect(await f.context('a-task')).toBe('');
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);

test('a task memory forgotten during the remote write is never made recallable after acknowledgement', async () => {
  const f = await fixture();
  try {
    const confirm = f.adapter.confirmMemory.bind(f.adapter);
    vi.spyOn(f.adapter, 'confirmMemory').mockImplementationOnce(async (...args) => {
      const result = await confirm(...args);
      const [pending] = f.privateMemory.list(f.a);
      await f.privateMemory.forget(f.a, pending.id);
      return result;
    });
    await f.tool('a-task').execute('in-flight', {
      action: PiMemoryAction.Save,
      title: 'Paper kite',
      content: 'The paper kite must be withdrawn.',
    });
    await f.service.retryPendingOutbox();
    expect(f.privateMemory.list(f.a)).toEqual([]);
    expect(await f.context('a-task')).toBe('');
    expect(await f.context('b-task')).toBe('');
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);

test('Chinese continuation prompts recall new private facts added since the first turn', async () => {
  const f = await fixture();
  try {
    await f.privateMemory.save({
      petId: f.a,
      requestId: 'first',
      kind: MemoryKind.Preference,
      title: '整理项目资料',
      content: '整理项目资料 original-cobalt',
    });
    expect(await f.context('a-task', '整理项目资料，并告诉我接下来该做什么。')).toContain(
      'original-cobalt',
    );
    await f.privateMemory.save({
      petId: f.a,
      requestId: 'later',
      kind: MemoryKind.Preference,
      title: '整理项目资料',
      content: '整理项目资料 later-amber',
    });
    expect(await f.context('a-task', '整理项目资料，继续完成。')).toContain('later-amber');
  } finally {
    await f.cleanup();
  }
}, 60_000);
