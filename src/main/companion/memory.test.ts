import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import {
  MemoryKind,
  MemoryScope,
  MemoryLifecycleStatus,
  MemorySourceKind,
} from '../../shared/memory';
import { ATOMIC_MEMORY_EXTRACTOR_VERSION, MemoryExtractorKind } from '../memory/constants';
import { companionMemoryNeedsReview } from '../../shared/companion/memoryStatus';
import { EngramManager } from '../memory/engramManager';
import { MemoryRepository } from '../memory/repository';
import { ProjectMemoryService } from '../memory/projectMemoryService';
import { resolveProjectIdentity } from '../memory/projectIdentity';
import { ZhiYuanEngramAdapter } from '../memory/zhiyuanEngramAdapter';
import { CompanionMemoryService, companionMemoryIdentity } from './memory';
import { CompanionMemoryRetractions } from './memoryRetractions';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-memory-'));
  const manager = new EngramManager({ userDataPath: root, projectRoot: process.cwd() });
  const db = new Database(path.join(root, 'projection.sqlite'));
  const repository = new MemoryRepository(db);
  const adapter = new ZhiYuanEngramAdapter(manager);
  const shared = new ProjectMemoryService(
    repository,
    adapter,
    resolveProjectIdentity,
    path.join(root, 'personal'),
  );
  const service = new CompanionMemoryService(
    repository,
    adapter,
    shared,
    path.join(root, 'companions'),
    new CompanionMemoryRetractions(db),
  );
  const a = randomUUID(),
    b = randomUUID();
  const save = (
    petId: string,
    requestId: string,
    content = 'The paper kite for this companion is blue.',
    replacesId?: string,
  ) =>
    service.save({
      petId,
      requestId,
      title: 'Paper kite',
      content,
      kind: MemoryKind.Preference,
      replacesId,
    });
  return {
    root,
    a,
    b,
    adapter,
    shared,
    repository,
    service,
    save,
    cleanup: async () => {
      await manager.stop();
      db.close();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

function taskCandidate(f: Awaited<ReturnType<typeof fixture>>) {
  const owner = companionMemoryIdentity(f.a);
  const id = f.repository.createPersonalCandidate({
    projectId: owner.projectId,
    projectRoot: path.join(f.root, 'companions', f.a),
    scope: MemoryScope.Companion,
    sessionId: 'owned-task',
    sourceKind: MemorySourceKind.TaskVerifier,
    title: 'Paper kite',
    content: 'The paper kite uses a bamboo frame.',
    kind: MemoryKind.Decision,
    taskId: 'task-1',
    runId: 'run-1',
    metadata: {
      extraction: {
        extractorKind: MemoryExtractorKind.Atomic,
        extractorVersion: ATOMIC_MEMORY_EXTRACTOR_VERSION,
      },
    },
  });
  return {
    petId: f.a,
    id,
    title: 'Paper kite',
    content: 'The paper kite uses a bamboo frame.',
    kind: MemoryKind.Decision,
    confirmed: true as const,
  };
}

test('task candidates require exact reviewed text and remain private after idempotent confirmation', async () => {
  const f = await fixture();
  try {
    const input = taskCandidate(f);
    expect(companionMemoryNeedsReview(f.service.list(f.a)[0])).toBe(true);
    expect(await f.service.context(f.a, 'paper kite')).toBe('');
    await expect(f.service.confirm({ ...input, confirmed: false } as never)).rejects.toThrow();
    await expect(f.service.confirm({ ...input, content: 'Different paper kite.' })).rejects.toThrow(
      'changed',
    );
    await expect(f.service.confirm({ ...input, petId: f.b })).rejects.toThrow('Memory not found');
    const confirm = vi.spyOn(f.adapter, 'confirmMemory');
    const saved = await f.service.confirm(input);
    expect(saved.memoryId).not.toBeNull();
    expect(saved.status).toBe(MemoryLifecycleStatus.Active);
    expect(companionMemoryNeedsReview(saved)).toBe(false);
    expect(await f.service.context(f.a, 'paper kite')).toContain('bamboo');
    expect(await f.service.context(f.b, 'paper kite')).toBe('');
    expect(f.shared.listManagedMemories()).toEqual([]);
    expect((await f.service.confirm(input)).memoryId).toBe(saved.memoryId);
    expect(confirm).toHaveBeenCalledOnce();
    await f.service.forget(f.a, input.id);
    await expect(f.service.confirm(input)).rejects.toThrow('not available');
    expect(await f.service.context(f.a, 'paper kite')).toBe('');
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);

test('offline approved candidates are pending sync, and retries never duplicate delivery or resurrect deletion', async () => {
  const f = await fixture();
  try {
    const input = taskCandidate(f);
    const confirm = vi.spyOn(f.adapter, 'confirmMemory').mockResolvedValueOnce(null);
    const queued = await f.service.confirm(input);
    expect(queued.memoryId).toBeNull();
    expect(companionMemoryNeedsReview(queued)).toBe(false);
    expect((await f.service.confirm(input)).id).toBe(queued.id);
    expect(confirm).toHaveBeenCalledOnce();
    await f.service.forget(f.a, queued.id);
    await f.shared.retryPendingOutbox();
    await expect(f.service.confirm(input)).rejects.toThrow('Memory not found');
    expect(f.service.list(f.a)).toEqual([]);
    expect(await f.service.context(f.a, 'paper kite')).toBe('');
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);

test('withdrawing an in-flight task confirmation prevents a successful review receipt', async () => {
  const f = await fixture();
  try {
    const input = taskCandidate(f);
    const confirm = f.adapter.confirmMemory.bind(f.adapter);
    vi.spyOn(f.adapter, 'confirmMemory').mockImplementationOnce(async (...args) => {
      const result = await confirm(...args);
      await f.service.forget(f.a, input.id);
      return result;
    });
    await expect(f.service.confirm(input)).rejects.toThrow('Memory not found');
    await f.shared.retryPendingOutbox();
    expect(f.service.list(f.a)).toEqual([]);
    expect(await f.service.context(f.a, 'paper kite')).toBe('');
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);

test('real memory runtime isolates companions and shares only after existing personal confirmation', async () => {
  const f = await fixture();
  try {
    const saved = await f.save(f.a, 'one');
    expect(saved.memoryId).not.toBeNull();
    expect(f.service.list(f.a)).toHaveLength(1);
    expect(f.service.list(f.b)).toEqual([]);
    expect(await f.service.context(f.a, 'paper kite')).toContain('is blue');
    expect(await f.service.context(f.b, 'paper kite')).toBe('');
    expect(f.shared.listManagedMemories()).toEqual([]);
    expect(f.shared.listRecallableMemories({ workingDirectory: f.root })).toEqual([]);
    await expect(
      f.shared.updateManualMemory({
        id: saved.id,
        workingDirectory: f.root,
        title: 'Wrong scope',
        content: 'Must not edit',
        kind: MemoryKind.Preference,
        sensitivity: saved.sensitivity,
      }),
    ).rejects.toThrow('Memory not found');
    const candidate = f.service.proposePersonal(f.a, saved.id, 'share-one');
    expect(f.service.proposePersonal(f.a, saved.id, 'share-one')).toBe(candidate);
    expect(f.repository.getCandidate(candidate)?.status).toBe(MemoryLifecycleStatus.NeedsReview);
    expect(await f.service.context(f.b, 'paper kite')).toBe('');
    await f.shared.confirmPersonalCandidate(candidate);
    expect(await f.service.context(f.b, 'paper kite')).toContain('is blue');
    expect(f.repository.getLink(saved.id)?.status).toBe(MemoryLifecycleStatus.Active);
    expect(f.repository.getLink(candidate)?.scope).toBe(MemoryScope.Personal);
    expect(f.repository.getLink(candidate)?.promotedFromLinkId).toBe(saved.id);
  } finally {
    await f.cleanup();
  }
}, 60_000);

test('idempotent saves, updates and forgetting cannot cross companion ownership', async () => {
  const f = await fixture();
  try {
    const original = await f.save(f.a, 'one');
    expect((await f.save(f.a, 'one')).id).toBe(original.id);
    await expect(f.save(f.a, 'one', 'Different contents')).rejects.toThrow('identity changed');
    await expect(
      f.save(f.b, 'wrong-owner', 'Overwrite another companion.', original.id),
    ).rejects.toThrow('Memory not found');
    await expect(f.service.forget(f.b, original.id)).rejects.toThrow('Memory not found');
    expect(() => f.service.proposePersonal(f.b, original.id, 'foreign')).toThrow(
      'Memory not found',
    );
    const replacement = await f.save(f.a, 'two', 'The paper kite is now green.', original.id);
    expect(f.repository.getLink(original.id)?.status).toBe(MemoryLifecycleStatus.Superseded);
    const current = await f.service.context(f.a, 'paper kite');
    expect(current).toContain('now green');
    expect(current).not.toContain('is blue');
    expect(await f.service.forget(f.a, replacement.id)).toBe(true);
    expect(f.service.list(f.a)).toEqual([]);
    expect(f.repository.getLink(replacement.id)?.status).toBe(MemoryLifecycleStatus.Deleted);
    expect(await f.service.context(f.a, 'paper kite')).toBe('');
    expect(() => companionMemoryIdentity('../foreign')).toThrow();
  } finally {
    await f.cleanup();
  }
}, 60_000);

test('offline private writes use the existing outbox and drain once without duplicate records', async () => {
  const f = await fixture();
  try {
    const confirm = vi.spyOn(f.adapter, 'confirmMemory').mockResolvedValueOnce(null);
    const queued = await f.save(f.a, 'offline');
    expect(queued.memoryId).toBeNull();
    expect(f.repository.listPending()).toHaveLength(0);
    expect((await f.save(f.a, 'offline')).id).toBe(queued.id);
    expect(confirm).toHaveBeenCalledOnce();
    await f.shared.retryPendingOutbox();
    const saved = await f.save(f.a, 'offline');
    expect(saved.memoryId).not.toBeNull();
    expect(f.service.list(f.a)).toHaveLength(1);
    expect(await f.service.context(f.a, 'paper kite')).toContain('is blue');
    expect(confirm).toHaveBeenCalledTimes(2);
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);

test('a personal proposal is revalidated if its private source is forgotten before confirmation', async () => {
  const f = await fixture();
  try {
    const saved = await f.save(f.a, 'one');
    const proposed = f.service.proposePersonal(f.a, saved.id, 'share-one');
    await f.service.forget(f.a, saved.id);
    await expect(f.shared.confirmPersonalCandidate(proposed)).rejects.toThrow('must be active');
    expect(f.repository.getCandidate(proposed)?.status).toBe(MemoryLifecycleStatus.NeedsReview);
    expect(await f.service.context(f.b, 'paper kite')).toBe('');
  } finally {
    await f.cleanup();
  }
}, 60_000);

test('forgetting an offline write survives request replay and a new database connection', async () => {
  const f = await fixture();
  try {
    vi.spyOn(f.adapter, 'confirmMemory').mockResolvedValueOnce(null);
    const pending = await f.save(f.a, 'withdrawn');
    await f.service.forget(f.a, pending.id);
    await f.shared.retryPendingOutbox();
    await expect(f.save(f.a, 'withdrawn')).rejects.toThrow('withdrawn');
    expect(f.service.list(f.a)).toEqual([]);
    const reopened = new Database(path.join(f.root, 'projection.sqlite'));
    try {
      expect(new CompanionMemoryRetractions(reopened).has(pending.id)).toBe(true);
    } finally {
      reopened.close();
    }
    expect(await f.service.context(f.a, 'paper kite')).toBe('');
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);

test('forgetting during an in-flight private write does not resurrect it after acknowledgement', async () => {
  const f = await fixture();
  try {
    const confirm = f.adapter.confirmMemory.bind(f.adapter);
    const forgotten = vi.spyOn(f.adapter, 'forget');
    vi.spyOn(f.adapter, 'confirmMemory').mockImplementationOnce(async (...args) => {
      const result = await confirm(...args);
      const pending = f.service.list(f.a)[0];
      await f.service.forget(f.a, pending.id);
      return result;
    });
    await expect(f.save(f.a, 'in-flight')).rejects.toThrow('Memory not found');
    expect(f.service.list(f.a)).toEqual([]);
    expect(forgotten).toHaveBeenCalledOnce();
    expect(await f.service.context(f.a, 'paper kite')).toBe('');
    await f.shared.retryPendingOutbox();
    expect(f.service.list(f.a)).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);

test('sharing revalidates its source after the remote write and keeps a confirmed copy on a lost-reply retry', async () => {
  const f = await fixture();
  try {
    const saved = await f.save(f.a, 'private');
    const confirm = f.adapter.confirmMemory.bind(f.adapter);
    vi.spyOn(f.adapter, 'confirmMemory').mockImplementationOnce(async (...args) => {
      const result = await confirm(...args);
      await f.service.forget(f.a, saved.id);
      return result;
    });
    await expect(f.service.shareConfirmed(f.a, saved.id, 'obsolete')).rejects.toThrow(
      'Memory not found',
    );
    expect(await f.service.context(f.b, 'paper kite')).toBe('');
    const another = await f.save(f.a, 'another');
    const receipt = await f.service.shareConfirmed(f.a, another.id, 'confirmed');
    expect(receipt.available).toBe(true);
    await f.service.forget(f.a, another.id);
    expect(await f.service.shareConfirmed(f.a, another.id, 'confirmed')).toEqual(receipt);
    expect(await f.service.context(f.b, 'paper kite')).toContain('is blue');
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);

test('an unavailable cleanup is retried without making a cancelled remote observation recallable', async () => {
  const f = await fixture();
  try {
    const confirm = f.adapter.confirmMemory.bind(f.adapter);
    const forgotten = vi.spyOn(f.adapter, 'forget').mockResolvedValueOnce(false);
    vi.spyOn(f.adapter, 'confirmMemory').mockImplementationOnce(async (...args) => {
      const result = await confirm(...args);
      await f.service.forget(f.a, f.service.list(f.a)[0].id);
      return result;
    });
    await expect(f.save(f.a, 'cleanup-offline')).rejects.toThrow('Memory not found');
    expect(forgotten).toHaveBeenCalledOnce();
    expect(await f.service.context(f.a, 'paper kite')).toBe('');
    await f.shared.retryPendingOutbox();
    expect(forgotten).toHaveBeenCalledTimes(2);
    expect(f.service.list(f.a)).toEqual([]);
    expect(await f.service.context(f.a, 'paper kite')).toBe('');
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);

test('retrying an offline confirmed share reuses its pending delivery rather than enqueueing another write', async () => {
  const f = await fixture();
  try {
    const saved = await f.save(f.a, 'to-share');
    const confirm = vi.spyOn(f.adapter, 'confirmMemory').mockResolvedValueOnce(null);
    const receipt = await f.service.shareConfirmed(f.a, saved.id, 'offline-share');
    expect(receipt.available).toBe(false);
    expect(await f.service.shareConfirmed(f.a, saved.id, 'offline-share')).toEqual(receipt);
    expect(confirm).toHaveBeenCalledOnce();
    await f.shared.retryPendingOutbox();
    expect((await f.service.shareConfirmed(f.a, saved.id, 'offline-share')).available).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(await f.service.context(f.b, 'paper kite')).toContain('is blue');
  } finally {
    vi.restoreAllMocks();
    await f.cleanup();
  }
}, 60_000);
