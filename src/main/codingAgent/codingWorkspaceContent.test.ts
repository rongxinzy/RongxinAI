import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, expect, test, vi } from 'vitest';
import { CodingAgentProfileId, CodingErrorMessage } from '../../shared/codingAgent';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { CodingRoomRepository } from './codingRoomRepository';
import { CodingRoomService } from './codingRoomService';
import { initializeCodingAgentSchema } from './schema';

const workerFixture = vi.hoisted(() => ({ dispose: undefined as (() => void) | undefined }));

vi.mock('../workbenchTask/artifactWorkerPool', async importOriginal => {
  const actual = await importOriginal<typeof import('../workbenchTask/artifactWorkerPool')>();
  const pool = new actual.WorkbenchArtifactWorkerPool(
    path.resolve('dist-electron/artifactWorker.js'),
  );
  workerFixture.dispose = () => pool.dispose();
  return {
    ...actual,
    inspectWorkspaceContentAsync: (content: Uint8Array) =>
      pool.inspectContent(Uint8Array.from(content).buffer),
  };
});

let root: string;
let db: Database.Database;
let service: CodingRoomService;
afterEach(async () => {
  await service?.dispose();
  db?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
afterAll(() => workerFixture.dispose?.());

test('real worker inspection preserves preview hashes, save results and external-edit protection', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'coding-content-worker-'));
  db = new Database(':memory:');
  initializeCodingAgentSchema(db);
  service = new CodingRoomService(new CodingRoomRepository(db), new CodingAgentRegistry(), {
    startBuiltinSession: async () => undefined,
    cancelBuiltinSession: async () => undefined,
    getBuiltinWorkbenchLink: () => null,
    beginExternalWorkbenchRun: () => ({ taskId: 'task', runId: 'run' }),
    completeExternalWorkbenchRun: () => undefined,
  });
  service.createWorkspace({
    name: 'test',
    sourceFolders: [root],
    defaultProfileId: CodingAgentProfileId.Builtin,
  });
  const input = { workspaceRoot: root, sourceRoot: root, path: 'note.txt' };
  await writeFile(path.join(root, input.path), '原始内容\r\n');
  const preview = await service.readWorkspaceFile(input);
  expect(preview).toMatchObject({
    content: '原始内容\r\n',
    sha256: createHash('sha256').update('原始内容\r\n').digest('hex'),
  });
  const saved = await service.writeWorkspaceFile({
    ...input,
    expectedSha256: preview.sha256,
    content: '修改后\n',
  });
  expect(await readFile(path.join(root, input.path), 'utf8')).toBe('修改后\n');
  expect(saved.sha256).toBe(createHash('sha256').update('修改后\n').digest('hex'));
  await writeFile(path.join(root, input.path), '外部修改');
  await expect(
    service.writeWorkspaceFile({ ...input, expectedSha256: saved.sha256, content: '覆盖' }),
  ).rejects.toThrow(CodingErrorMessage.FileEditChanged);
  expect(await readFile(path.join(root, input.path), 'utf8')).toBe('外部修改');
  await writeFile(path.join(root, input.path), Buffer.from([0, 1, 2]));
  await expect(service.readWorkspaceFile(input)).rejects.toThrow(
    CodingErrorMessage.FilePreviewBinary,
  );
});
