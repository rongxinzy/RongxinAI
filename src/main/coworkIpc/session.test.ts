import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';
import { recoverPendingCoworkStartImages } from '../coworkImageAttachments';
import { CoworkStore } from '../coworkStore';
import { createCoworkStoreHarness } from '../coworkStore/coworkStore.testHarness';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { lifecycleRuntime } from '../appBootstrap/lifecycleRuntimeState';
import { classifyCoworkError } from '../../common/coworkError';
import { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import * as sessionExperts from '../appBootstrap/sessionExperts';
import {
  CoworkSessionExpertSource,
  type CoworkSessionExpertInput,
} from '../../shared/cowork/sessionExperts';
import { registerCoworkQueueIpc, type CoworkQueueIpcDeps } from './queue';
import { registerCoworkSessionIpc, type CoworkSessionIpcDeps } from './session';
import { startCoworkSession } from './sessionStart';
import { initializeWorkbenchTaskSchema } from '../workbenchTask/schema';
import { WorkbenchTaskService } from '../workbenchTask/taskService';
import { WorkbenchExecutionStatus } from '../../shared/workbenchTask';

vi.mock('../ipc/handleIpcContract', () => ({ handleIpcContract: vi.fn() }));
vi.mock('../appBootstrap/sessionExperts', async importOriginal => ({
  ...(await importOriginal<typeof import('../appBootstrap/sessionExperts')>()),
  resolveCoworkPromptLanguage: () => 'en',
}));
vi.mock('../workbenchTask/artifactWorkerPool', () => ({
  decodeCoworkImageAsync: async (data: string) => ({
    bytes: Uint8Array.from(Buffer.from(data, 'base64')).buffer,
    hash: 'a'.repeat(32),
  }),
}));

test('forwards a permission response from session IPC to the current Pi adapter', async () => {
  const respondToPermission = vi.fn();
  registerCoworkSessionIpc({
    getPiRuntimeAdapter: () => ({ respondToPermission }),
  } as unknown as CoworkSessionIpcDeps);
  const handlers = vi.mocked(handleIpcContract).mock.lastCall?.[1];
  const result = { behavior: 'deny', message: 'Permission denied' };

  await expect(
    handlers!.respondToPermission({} as never, { requestId: 'request-1', result }),
  ).resolves.toEqual({ success: true });
  expect(respondToPermission).toHaveBeenCalledWith('request-1', result);
});

test('rejects foreground input reserved for scheduled delivery without publishing a run error', async () => {
  const runtime = {
    isSessionReservedForDelivery: vi.fn(() => true),
    continueSession: vi.fn(),
    emit: vi.fn(),
  };
  const getCoworkStore = vi.fn();
  registerCoworkSessionIpc({
    getPiRuntimeAdapter: () => runtime,
    getCoworkStore,
  } as unknown as CoworkSessionIpcDeps);
  const handlers = vi.mocked(handleIpcContract).mock.calls.at(-1)?.[1] as {
    continueSession: (event: unknown, input: { sessionId: string; prompt: string }) => unknown;
  };

  await expect(
    handlers.continueSession({}, { sessionId: 'scheduled', prompt: 'Foreground request' }),
  ).resolves.toMatchObject({ success: false, error: expect.any(String) });
  expect(runtime.isSessionReservedForDelivery).toHaveBeenCalledWith('scheduled');
  expect(getCoworkStore).not.toHaveBeenCalled();
  expect(runtime.continueSession).not.toHaveBeenCalled();
  expect(runtime.emit).not.toHaveBeenCalled();
});

test('Work continuation reports a new dispatch failure after an earlier terminal error', async () => {
  const { db, store } = createCoworkStoreHarness();
  const error = new Error('No enabled provider found for model: qwen-local');
  const runtime = new PiRuntimeAdapter({ coworkStore: store });
  const publish = vi.fn();
  runtime.on('error', publish);
  vi.spyOn(runtime, 'continueSession').mockRejectedValue(error);
  try {
    const { id } = store.createSession('Retry a Work session', process.cwd());
    store.recordTerminalError(id, classifyCoworkError('Request timed out'), vi.fn());
    registerCoworkSessionIpc({
      getPiRuntimeAdapter: () => runtime,
      getCoworkStore: () => store,
    } as unknown as CoworkSessionIpcDeps);
    const handlers = vi.mocked(handleIpcContract).mock.lastCall?.[1];
    await expect(
      handlers!.continueSession({} as never, { sessionId: id, prompt: 'Retry.' }),
    ).resolves.toMatchObject({ success: true });
    await vi.waitFor(() =>
      expect(publish).toHaveBeenCalledExactlyOnceWith(id, classifyCoworkError(error.message)),
    );
    expect(store.messages.getSessionMessages(id).map(message => message.metadata?.error)).toEqual([
      'Request timed out',
      error.message,
    ]);
  } finally {
    db.close();
  }
});

test('Work continuation appends new session skills and skips writes for unchanged selections', async () => {
  const { db, store } = createCoworkStoreHarness();
  const runtime = new PiRuntimeAdapter({ coworkStore: store });
  const dispatch = vi.spyOn(runtime, 'continueSession').mockResolvedValue(undefined);
  try {
    const { id } = store.createSession('Work skills', process.cwd(), '', 'local', ['pptx']);
    db.exec(`
      CREATE TABLE skill_writes (session_id TEXT);
      CREATE TRIGGER record_skill_write AFTER UPDATE OF active_skill_ids ON cowork_sessions
      BEGIN INSERT INTO skill_writes VALUES (NEW.id); END;
    `);
    registerCoworkSessionIpc({
      getPiRuntimeAdapter: () => runtime,
      getCoworkStore: () => store,
    } as unknown as CoworkSessionIpcDeps);
    const handlers = vi.mocked(handleIpcContract).mock.lastCall?.[1];
    for (const activeSkillIds of [undefined, [], ['docx', 'pptx'], ['docx']]) {
      await expect(
        handlers!.continueSession({} as never, {
          sessionId: id,
          prompt: 'Continue',
          activeSkillIds,
        }),
      ).resolves.toMatchObject({ success: true });
    }
    expect(db.prepare('SELECT session_id FROM skill_writes').all()).toEqual([{ session_id: id }]);
    expect(store.getSession(id)?.activeSkillIds).toEqual(['pptx', 'docx']);
    expect(dispatch).toHaveBeenLastCalledWith(
      id,
      'Continue',
      expect.objectContaining({
        skillIds: ['pptx', 'docx'],
        attachedSkillIds: ['docx'],
      }),
    );
  } finally {
    db.close();
  }
});

test('an expert switch rolls back if its composed prompt cannot be persisted', async () => {
  const { db, store } = createCoworkStoreHarness();
  const expert: CoworkSessionExpertInput = {
    expertId: 'old',
    packageId: 'old',
    expertName: 'Old',
    source: CoworkSessionExpertSource.Package,
    promptSnapshot: 'Previous expert instructions',
    skillIds: [],
    contentHash: 'old',
  };
  const resolveExpert = vi
    .spyOn(sessionExperts, 'resolveSessionExpertSnapshots')
    .mockResolvedValue([
      { ...expert, expertId: 'new', promptSnapshot: 'Replacement expert instructions' },
    ]);
  const dispatch = vi.fn(async () => {});
  try {
    const { id } = store.createSession(
      'Expert work',
      process.cwd(),
      expert.promptSnapshot,
      undefined,
      [],
      undefined,
      '',
      'work',
      undefined,
      undefined,
      [expert],
    );
    db.exec(`CREATE TEMP TRIGGER reject_prompt BEFORE UPDATE OF system_prompt ON cowork_sessions
      BEGIN SELECT RAISE(ABORT, 'prompt write rejected'); END`);
    registerCoworkSessionIpc({
      getCoworkStore: () => store,
      getPiRuntimeAdapter: () => ({
        continueSession: dispatch,
        isSessionReservedForDelivery: () => false,
        isSessionRunning: () => false,
      }),
    } as unknown as CoworkSessionIpcDeps);
    const handlers = vi.mocked(handleIpcContract).mock.lastCall?.[1];
    const input = { sessionId: id, prompt: 'Proceed', expertIds: ['new'] };
    await expect(handlers!.continueSession({} as never, input)).resolves.toMatchObject({
      success: false,
    });
    expect(store.getSession(id)).toMatchObject({
      systemPrompt: expert.promptSnapshot,
      experts: [{ expertId: 'old' }],
    });
    expect(dispatch).not.toHaveBeenCalled();
    db.exec('DROP TRIGGER reject_prompt');
    await expect(handlers!.continueSession({} as never, input)).resolves.toMatchObject({
      success: true,
    });
    expect(store.getSession(id)).toMatchObject({
      systemPrompt: expect.stringContaining('Replacement expert instructions'),
      experts: [{ expertId: 'new' }],
    });
    expect(dispatch).toHaveBeenCalledOnce();
  } finally {
    resolveExpert.mockRestore();
    db.close();
  }
});

test('rechecks scheduled delivery ownership after loading a changed expert', async () => {
  const pending = Promise.withResolvers<CoworkSessionExpertInput[]>();
  const resolveExpert = vi
    .spyOn(sessionExperts, 'resolveSessionExpertSnapshots')
    .mockReturnValue(pending.promise);
  const runtime = {
    isSessionReservedForDelivery: vi.fn(() => false),
    continueSession: vi.fn(),
    emit: vi.fn(),
  };
  const localStore = {
    getSession: vi.fn(() => ({ experts: [] })),
    updateSessionPrompt: vi.fn(),
  };
  registerCoworkSessionIpc({
    getPiRuntimeAdapter: () => runtime,
    getCoworkStore: () => localStore,
  } as unknown as CoworkSessionIpcDeps);
  const handlers = vi.mocked(handleIpcContract).mock.lastCall?.[1];
  try {
    const continuation = handlers!.continueSession({} as never, {
      sessionId: 'work',
      prompt: 'Proceed',
      expertIds: ['new'],
    });
    expect(resolveExpert).toHaveBeenCalledWith(['new']);
    runtime.isSessionReservedForDelivery.mockReturnValue(true);
    pending.resolve([]);
    await expect(continuation).resolves.toMatchObject({ success: false });
    expect(localStore.updateSessionPrompt).not.toHaveBeenCalled();
    expect(runtime.continueSession).not.toHaveBeenCalled();
    expect(runtime.emit).not.toHaveBeenCalled();
  } finally {
    resolveExpert.mockRestore();
  }
});

test('quit closes Cowork continuation before it reads or changes the session', async () => {
  const getCoworkStore = vi.fn();
  const getPiRuntimeAdapter = vi.fn();
  registerCoworkSessionIpc({
    getPiRuntimeAdapter,
    getCoworkStore,
  } as unknown as CoworkSessionIpcDeps);
  const handlers = vi.mocked(handleIpcContract).mock.lastCall?.[1];
  lifecycleRuntime.isQuitting = true;
  try {
    await expect(
      handlers!.continueSession({} as never, { sessionId: 'active', prompt: 'Late turn' }),
    ).resolves.toEqual({ success: false, error: 'The application is shutting down.' });
    expect(getCoworkStore).not.toHaveBeenCalled();
    expect(getPiRuntimeAdapter).not.toHaveBeenCalled();
  } finally {
    lifecycleRuntime.isQuitting = false;
  }
});

const image = { name: 'shot.png', mimeType: 'image/png', base64Data: 'YQ==' };

test('Work start commits the input and reserved run before publishing the image and launching Pi', async () => {
  const harness = createCoworkStoreHarness();
  initializeWorkbenchTaskSchema(harness.db);
  const workbench = new WorkbenchTaskService(harness.db);
  const root = await mkdtemp(path.join(tmpdir(), 'cowork-ipc-image-'));
  try {
    const imageRoot = path.join(root, 'images');
    const imageName = `${'a'.repeat(32)}.png`;
    const publishedBeforePrepare: string[][] = [];
    const publishedAtLaunch: boolean[] = [];
    const runAtLaunch = vi.fn();
    const startSession = vi.fn(async (id: string) => {
      publishedAtLaunch.push(existsSync(path.join(imageRoot, id, imageName)));
      runAtLaunch(workbench.getCurrent(id)?.runs[0]);
    });
    registerCoworkSessionIpc({
      getPiRuntimeAdapter: () => ({ startSession, isSessionRunning: () => true }),
      getCoworkStore: () => harness.store,
      getWorkbenchTaskService: () => workbench,
      getCoworkImageRoot: () => imageRoot,
      getAgentManager: () => ({
        getAgent: () => {
          publishedBeforePrepare.push(readdirSync(imageRoot).filter(name => !name.startsWith('.')));
        },
      }),
      resolveSessionWorkingDirectory: () => root,
      resolveTaskWorkingDirectory: async () => root,
    } as unknown as CoworkSessionIpcDeps);
    const handlers = vi.mocked(handleIpcContract).mock.calls.at(-1)?.[1] as {
      startSession: (
        event: unknown,
        input: { prompt: string; imageAttachments: Array<typeof image> },
      ) => Promise<{ success: boolean; session: { id: string } }>;
    };

    const result = await handlers.startSession(
      {},
      { prompt: 'See attached', imageAttachments: [image] },
    );
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(publishedBeforePrepare).toEqual([[]]);
    expect(publishedAtLaunch).toEqual([true]);
    const { id } = result.session;
    const reserved = workbench.getCurrent(id);
    expect(reserved?.task.goal).toBe('See attached');
    expect(runAtLaunch).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: reserved?.runs[0].id,
        status: WorkbenchExecutionStatus.Queued,
      }),
    );
    expect(result.session).toMatchObject({ status: 'running' });
    expect(harness.store.getSession(id)?.status).toBe('idle');
    const imagePath = path.join(imageRoot, id, imageName);
    const savedImages = [{ name: image.name, mimeType: image.mimeType, path: imagePath }];
    expect(harness.store.messages.getSessionMessages(id)[0].metadata?.imageAttachments).toEqual(
      savedImages,
    );
    expect(startSession).toHaveBeenCalledWith(
      id,
      'See attached',
      expect.objectContaining({
        imageAttachments: savedImages,
        workbenchReservation: { taskId: reserved?.task.id, runId: reserved?.runs[0].id },
      }),
    );
    expect(await readFile(imagePath, 'utf8')).toBe('a');
  } finally {
    harness.db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed start discards unpublished images only when the initial message did not commit', async () => {
  const harness = createCoworkStoreHarness();
  initializeWorkbenchTaskSchema(harness.db);
  const workbench = new WorkbenchTaskService(harness.db);
  const root = await mkdtemp(path.join(tmpdir(), 'cowork-start-failure-'));
  const imageRoot = path.join(root, 'images');
  const deps = {
    getCoworkImageRoot: () => imageRoot,
    getCoworkStore: () => harness.store,
    getWorkbenchTaskService: () => workbench,
    getAgentManager: () => ({ getAgent: () => undefined }),
    getPiRuntimeAdapter: () => {
      throw new Error('Runtime unavailable');
    },
    resolveSessionWorkingDirectory: () => root,
    resolveTaskWorkingDirectory: async () => root,
  } as unknown as CoworkSessionIpcDeps;
  try {
    await expect(
      startCoworkSession(
        { ...deps, resolveSessionWorkingDirectory: () => '' },
        {
          prompt: 'Rejected start',
          imageAttachments: [image],
        },
      ),
    ).resolves.toMatchObject({ success: false });
    const staged = path.join(imageRoot, '.pending-starts');
    expect((await readdir(staged)).filter(name => !name.startsWith('.'))).toEqual([]);

    harness.db.exec(`
      CREATE TEMP TRIGGER reject_first_message BEFORE INSERT ON cowork_messages
      WHEN NEW.content = 'Interrupted first write'
      BEGIN SELECT RAISE(ABORT, 'first message rejected'); END;
    `);
    await expect(
      startCoworkSession(deps, {
        prompt: 'Interrupted first write',
        imageAttachments: [image],
      }),
    ).resolves.toMatchObject({ success: false, error: 'first message rejected' });
    expect(harness.db.prepare('SELECT COUNT(*) FROM cowork_sessions').pluck().get()).toBe(0);
    expect(harness.db.prepare('SELECT COUNT(*) FROM workbench_runs').pluck().get()).toBe(0);
    expect((await readdir(staged)).filter(name => !name.startsWith('.'))).toEqual([]);

    await expect(
      startCoworkSession(deps, {
        prompt: 'Committed start',
        imageAttachments: [image],
      }),
    ).resolves.toMatchObject({ success: false, error: 'Runtime unavailable' });
    const [sessionId] = (await readdir(staged)).filter(name => !name.startsWith('.'));
    expect(workbench.getCurrent(sessionId)?.runs[0]).toMatchObject({
      status: WorkbenchExecutionStatus.Failed,
      failure: { message: 'Runtime unavailable' },
    });
    expect(harness.store.messages.getPagedSessionMessages(sessionId, 1, 0)[0].content).toBe(
      'Committed start',
    );
    expect(existsSync(path.join(imageRoot, sessionId))).toBe(false);
    await recoverPendingCoworkStartImages(imageRoot, harness.store);
    expect(await readFile(path.join(imageRoot, sessionId, `${'a'.repeat(32)}.png`), 'utf8')).toBe(
      'a',
    );
  } finally {
    harness.db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Chat starts through Pi without reserving a Workbench run', async () => {
  const { db, store } = createCoworkStoreHarness();
  const getWorkbenchTaskService = vi.fn();
  const startSession = vi.fn().mockResolvedValue(undefined);
  try {
    await expect(
      startCoworkSession(
        {
          getCoworkStore: () => store,
          getWorkbenchTaskService,
          getPiRuntimeAdapter: () => ({ startSession, isSessionRunning: () => false }),
          getAgentManager: () => ({ getAgent: () => undefined }),
          resolveSessionWorkingDirectory: () => '/tmp/chat',
          resolveTaskWorkingDirectory: async (cwd: string) => cwd,
        } as unknown as CoworkSessionIpcDeps,
        { prompt: 'Hello', mode: 'chat' },
      ),
    ).resolves.toMatchObject({ success: true });
    expect(getWorkbenchTaskService).not.toHaveBeenCalled();
    expect(startSession).toHaveBeenCalledWith(
      expect.any(String),
      'Hello',
      expect.objectContaining({ workbenchReservation: undefined }),
    );
  } finally {
    db.close();
  }
});

test('restart publishes committed initial images and only discards unowned staged directories', async () => {
  const harness = createCoworkStoreHarness();
  const root = await mkdtemp(path.join(tmpdir(), 'cowork-start-recovery-'));
  const imageRoot = path.join(root, 'images');
  const stagingRoot = path.join(imageRoot, '.pending-starts');
  const fileName = `${'b'.repeat(32)}.png`;
  const [abandoned, blank, committed, conflict, ordinary] = Array.from({ length: 5 }, randomUUID);
  const scratch = path.join(stagingRoot, '.staging', randomUUID());
  const finalImage = (id: string) => path.join(imageRoot, id, fileName);
  const writeImage = async (file: string, value: string) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, value);
  };
  let recoveredDatabase: Database.Database | undefined;
  try {
    for (const id of [abandoned, blank, committed, conflict]) {
      await writeImage(path.join(stagingRoot, id, fileName), `${id} staged`);
    }
    for (const id of [blank, committed, conflict]) {
      harness.store.createSession(
        'Image start',
        root,
        undefined,
        undefined,
        [],
        'main',
        '',
        'work',
        id,
      );
      if (id !== blank) {
        harness.store.messages.addMessage(id, {
          type: 'user',
          content: 'See attached',
          metadata: { imageAttachments: [{ path: finalImage(id) }] },
        });
      }
    }
    await writeImage(finalImage(conflict), 'published first');
    await writeImage(finalImage(ordinary), 'ordinary image');
    await writeImage(scratch, 'partial write');
    const dbPath = path.join(root, 'after-crash.sqlite');
    await harness.db.backup(dbPath);
    recoveredDatabase = new Database(dbPath);
    const store = new CoworkStore(recoveredDatabase);

    await recoverPendingCoworkStartImages(imageRoot, store);

    expect(await readFile(finalImage(committed), 'utf8')).toBe(`${committed} staged`);
    expect(await readFile(finalImage(conflict), 'utf8')).toBe('published first');
    expect(await readFile(finalImage(ordinary), 'utf8')).toBe('ordinary image');
    expect((await readdir(stagingRoot)).sort()).toEqual(['.staging', conflict]);
    expect(existsSync(scratch)).toBe(false);
    expect(existsSync(finalImage(abandoned))).toBe(false);
    expect(existsSync(finalImage(blank))).toBe(false);
  } finally {
    recoveredDatabase?.close();
    harness.db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('a stale continuation with an image is rejected before opening the image root', async () => {
  const runtime = { isSessionReservedForDelivery: () => false, continueSession: vi.fn() };
  const getCoworkImageRoot = vi.fn(() => {
    throw new Error('image root accessed');
  });
  registerCoworkSessionIpc({
    getPiRuntimeAdapter: () => runtime,
    getCoworkStore: () => ({ getSession: () => null }),
    getCoworkImageRoot,
  } as unknown as CoworkSessionIpcDeps);
  const handlers = vi.mocked(handleIpcContract).mock.calls.at(-1)?.[1] as {
    continueSession: (
      event: unknown,
      input: { sessionId: string; prompt: string; imageAttachments: Array<typeof image> },
    ) => unknown;
  };

  await expect(
    handlers.continueSession(
      {},
      { sessionId: 'deleted', prompt: 'See attached', imageAttachments: [image] },
    ),
  ).resolves.toMatchObject({ success: false, error: expect.any(String) });
  expect(getCoworkImageRoot).not.toHaveBeenCalled();
  expect(runtime.continueSession).not.toHaveBeenCalled();
});

test('queue IPC leaves image persistence to the runtime after queue admission', async () => {
  const rejection = { success: false, error: 'The Work session is not running.' };
  const runtime = { enqueuePendingMessage: vi.fn().mockResolvedValue(rejection) };
  const getCoworkImageRoot = vi.fn(() => {
    throw new Error('image root accessed');
  });
  const deps = {
    getPiRuntimeAdapter: () =>
      runtime as unknown as ReturnType<CoworkQueueIpcDeps['getPiRuntimeAdapter']>,
    getCoworkStore: vi.fn(),
    getCoworkImageRoot,
  };
  registerCoworkQueueIpc(deps);
  const handlers = vi.mocked(handleIpcContract).mock.calls.at(-1)?.[1] as {
    enqueuePendingMessage: (
      event: unknown,
      input: { sessionId: string; text: string; imageAttachments: Array<typeof image> },
    ) => unknown;
  };

  await expect(
    handlers.enqueuePendingMessage(
      {},
      { sessionId: 'deleted', text: 'See attached', imageAttachments: [image] },
    ),
  ).resolves.toBe(rejection);
  expect(runtime.enqueuePendingMessage).toHaveBeenCalledWith(
    'deleted',
    'See attached',
    [image],
    undefined,
    undefined,
  );
  expect(getCoworkImageRoot).not.toHaveBeenCalled();
});
