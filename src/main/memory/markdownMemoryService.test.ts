import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import {
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  PERSONAL_MEMORY_PROJECT_ID,
} from '../../shared/memory';
import { MarkdownMemoryBackend } from './markdownMemoryBackend';
import { MarkdownMemoryRuntime } from './markdownMemoryRuntime';
import { EXPLICIT_MEMORY_SOURCE } from './explicitUserRequestedMemory';
import { ProjectMemoryService } from './projectMemoryService';
import { MemoryRepository } from './repository';

const fixtures: { db: Database.Database; service: ProjectMemoryService; root: string }[] = [];
afterEach(async () => {
  for (const { db, service, root } of fixtures.splice(0)) {
    await service.stopOutboxScheduler();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const db = new Database(':memory:');
  const repository = new MemoryRepository(db);
  const root = mkdtempSync(path.join(tmpdir(), 'markdown-memory-service-'));
  const runtime = new MarkdownMemoryRuntime(root);
  const service = new ProjectMemoryService(
    repository,
    new MarkdownMemoryBackend(runtime, repository),
    cwd => ({ id: `workspace-${cwd}`, root: cwd, displayName: cwd }),
    '/personal',
  );
  fixtures.push({ db, service, root });
  return { db, repository, service, runtime };
}
const note = {
  workingDirectory: '/work',
  scope: MemoryScope.Project,
  kind: MemoryKind.Decision,
  sensitivity: MemorySensitivity.Normal,
  title: 'Database choice',
  content: 'Use SQLite for persistence.',
} as const;

test('native memory honors workspace isolation, archive/restore and edit revision history', async () => {
  const { repository, service } = fixture();
  const created = await service.createManualMemory(note);
  expect(await service.recallProject({ workingDirectory: '/work', query: 'SQLite' })).toMatchObject(
    [{ id: created.memoryId }],
  );
  expect(await service.recallProject({ workingDirectory: '/other', query: 'SQLite' })).toEqual([]);
  await service.archiveMemory(created.id);
  expect(await service.recallProject({ workingDirectory: '/work', query: 'SQLite' })).toEqual([]);
  await service.restoreMemory(created.id);
  expect(await service.recallProject({ workingDirectory: '/work', query: 'SQLite' })).toHaveLength(
    1,
  );
  const replacement = await service.updateManualMemory({
    ...note,
    id: created.id,
    content: 'Use PostgreSQL for persistence.',
  });
  expect(repository.getLink(created.id)?.status).toBe(MemoryLifecycleStatus.Superseded);
  expect(replacement.memoryId).not.toBe(created.memoryId);
  expect(await service.recallProject({ workingDirectory: '/work', query: 'SQLite' })).toEqual([]);
  expect(
    await service.recallProject({ workingDirectory: '/work', query: 'PostgreSQL' }),
  ).toMatchObject([{ id: replacement.memoryId }]);
});

test('personal proposals require confirmation and expired notes are excluded from native recall', async () => {
  const { service } = fixture();
  const proposal = {
    sessionId: 'session-1',
    workingDirectory: '/work',
    type: MemoryKind.Preference,
    title: 'Language preference',
    content: 'Prefer concise Chinese reports.',
    metadata: { source: EXPLICIT_MEMORY_SOURCE },
  } as const;
  const id = service.proposePersonalMemory(proposal);
  expect(await service.recallPersonal({ query: 'Chinese' })).toEqual([]);
  await service.confirmPersonalCandidate(id);
  expect(await service.recallPersonal({ query: 'Chinese' })).toHaveLength(1);
  const expired = service.proposePersonalMemory({
    ...proposal,
    content: 'The temporary preference is expired.',
    expiresAt: '2020-01-01T00:00:00.000Z',
  });
  await service.confirmPersonalCandidate(expired);
  expect(await service.recallPersonal({ query: 'temporary' })).toEqual([]);
});

test('session checkpoints are delivered once and only recalled by their owning conversation', async () => {
  const { db, service } = fixture();
  await service.saveSessionSummary({
    sessionId: 'session-1',
    workingDirectory: '/work',
    summary: 'Checkpoint verified the SQLite report.',
    linkId: 'checkpoint-1',
    metadata: { format: 'agent-checkpoint' },
  });
  await service.retryPendingOutbox();
  const receipt = db.prepare('SELECT count(*) AS total FROM memory_links').get();
  expect(receipt).toEqual({ total: 1 });
  expect(
    await service.recallSession({
      sessionId: 'session-1',
      workingDirectory: '/work',
      query: 'SQLite',
    }),
  ).toHaveLength(1);
  expect(
    await service.recallSession({
      sessionId: 'session-2',
      workingDirectory: '/work',
      query: 'SQLite',
    }),
  ).toEqual([]);
  expect(await service.recallProject({ workingDirectory: '/work', query: 'SQLite' })).toEqual([]);
  await service.retryPendingOutbox();
  expect(db.prepare('SELECT count(*) AS total FROM memory_links').get()).toEqual(receipt);
});

test('native sections exclude unconfirmed, archived and expired governance records', async () => {
  const { service, runtime } = fixture();
  const active = await service.createManualMemory(note);
  service.proposePersonalMemory({
    sessionId: 'session-1',
    workingDirectory: '/work',
    type: MemoryKind.Preference,
    title: 'Unconfirmed',
    content: 'Pending private proposal.',
  });
  const expired = service.proposePersonalMemory({
    sessionId: 'session-1',
    workingDirectory: '/work',
    type: MemoryKind.Preference,
    title: 'Expired',
    content: 'Expired personal fact.',
    expiresAt: '2020-01-01T00:00:00.000Z',
  });
  await service.confirmPersonalCandidate(expired);
  await service.archiveMemory(active.id);
  const binding = (await service.createDurableMemoryBinding('/work'))!;
  const rendered = await Promise.all(
    binding.extension.sections!.map(section =>
      section.render({ conversationId: 1 } as never, BACKGROUND_CONTEXT),
    ),
  );
  expect(rendered.join('\n')).not.toContain('SQLite');
  expect(rendered.join('\n')).not.toContain('private proposal');
  expect(rendered.join('\n')).not.toContain('Expired personal');
  expect((await (await runtime.files(PERSONAL_MEMORY_PROJECT_ID)).read('user')).entries).toEqual(
    [],
  );
});

test('curation preserves governed identity, updates the projection and rejects marker stripping', async () => {
  const { service, repository } = fixture();
  const saved = await service.createManualMemory(note);
  const binding = (await service.createDurableMemoryBinding('/work'))!;
  const prefix = `[memory:${saved.memoryId}]`;
  const run = async (text: string) =>
    binding.maintain(
      {
        runs: 1,
        deadline: Date.now() + 5000,
        run: async () => ({
          status: 'completed',
          text: JSON.stringify([{ op: 'replace', match: prefix, text }]),
        }),
      },
      BACKGROUND_CONTEXT,
    );
  const changed = await run(`${prefix} Database choice\nUse PostgreSQL now.`);
  expect(changed.changes).toHaveLength(1);
  expect(repository.getLink(saved.id)?.content).toBe('Use PostgreSQL now.');
  const rejected = await run('Forgot the identity and confirmation boundary.');
  expect(rejected.changes).toHaveLength(0);
  expect(repository.getLink(saved.id)?.content).toBe('Use PostgreSQL now.');
});

test('hard delete clears plugin snapshots while retaining other current facts', async () => {
  const { service, runtime } = fixture();
  const { access, readdir, readFile, writeFile } = await import('node:fs/promises');
  const snapshots = async (owner: string) => {
    const directory = path.join(runtime.directory(owner), 'versions', 'memory');
    return Promise.all(
      (await readdir(directory)).map(name => readFile(path.join(directory, name), 'utf8')),
    );
  };
  const saved = await service.createManualMemory(note);
  await service.createManualMemory({ ...note, title: 'Retained choice', content: 'Keep Bun.' });
  await service.createManualMemory({
    ...note,
    workingDirectory: '/other',
    content: 'Other owner keeps a private choice.',
  });
  await service.createManualMemory({
    ...note,
    workingDirectory: '/other',
    title: 'Other next',
    content: 'Keep this too.',
  });
  const otherBefore = await snapshots('workspace-/other');
  const orphanName = 'MEMORY.md.12345678-1234-1234-1234-123456789abc.tmp';
  await writeFile(
    path.join(runtime.directory('workspace-/work'), orphanName),
    'old SQLite staging bytes',
  );
  await writeFile(
    path.join(runtime.directory('workspace-/other'), orphanName),
    'other owner staging bytes',
  );
  expect((await snapshots('workspace-/work')).join('\n')).toContain('SQLite');
  const files = await runtime.files('workspace-/work');
  await service.forgetMemory(saved.id, true);
  expect((await files.read('memory')).entries.join('\n')).not.toContain('SQLite');
  expect((await files.read('memory')).entries.join('\n')).toContain('Keep Bun');
  await expect(
    access(path.join(runtime.directory('workspace-/work'), 'versions')),
  ).rejects.toThrow();
  expect(await snapshots('workspace-/other')).toEqual(otherBefore);
  await expect(
    access(path.join(runtime.directory('workspace-/work'), orphanName)),
  ).rejects.toThrow();
  expect(await readFile(path.join(runtime.directory('workspace-/other'), orphanName), 'utf8')).toBe(
    'other owner staging bytes',
  );
  expect(
    (await (await runtime.files('workspace-/other')).read('memory')).entries.join('\n'),
  ).toContain('Other owner keeps a private choice.');
});
