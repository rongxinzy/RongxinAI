import { ipcMain } from 'electron';
import { afterEach, expect, test, vi } from 'vitest';
import {
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../shared/cowork/constants';
import {
  coworkConfigContract,
  coworkQueueContract,
  coworkSessionAdminContract,
  coworkSessionLifecycleContract,
} from '../../shared/ipc/coworkContract';
import { createCoworkStoreHarness } from '../coworkStore/coworkStore.testHarness';
import { setLanguage } from '../i18n';
import { registerCoworkConfigIpc } from './config';
import { registerCoworkQueueIpc } from './queue';
import { registerCoworkSessionIpc } from './session';
import { registerCoworkSessionAdminIpc } from './sessionAdmin';
import { prepareCoworkSession } from './sessionStart';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
  vi.restoreAllMocks();
});

function fixture() {
  const { db, store } = createCoworkStoreHarness();
  cleanup.push(() => db.close());
  setLanguage('en');
  cleanup.push(() => setLanguage('zh'));
  const id = 'automation:readonly';
  store.createSession(
    'Automation result',
    '/tmp',
    '',
    undefined,
    [],
    'main',
    '',
    CoworkSessionMode.Work,
    id,
    undefined,
    [],
    CoworkSessionSource.Scheduled,
  );
  store.addMessage(id, {
    type: 'assistant',
    content: 'Completed result with an attachment.',
    metadata: {
      fileAttachments: [{ name: 'report.csv', path: '/tmp/report.csv', extension: 'CSV' }],
    },
  });
  const runtime = {
    continueSession: vi.fn(),
    startSession: vi.fn(),
    compactSession: vi.fn(),
    enqueuePendingMessage: vi.fn(),
    updatePendingMessage: vi.fn(),
    deletePendingMessage: vi.fn(),
    steerPendingMessage: vi.fn(),
    followUpPendingMessage: vi.fn(),
    stopSession: vi.fn(),
    setApprovalModeForSession: vi.fn(),
    isSessionRunning: () => false,
  };
  const deps = {
    getCoworkStore: () => store,
    getPiRuntimeAdapter: () => runtime as never,
    getCoworkImageRoot: () => '/tmp',
    getAgentManager: () => null as never,
    getSkillManager: () => null as never,
    resolveSessionWorkingDirectory: () => '/tmp',
    resolveTaskWorkingDirectory: () => '/tmp',
  };
  type Handler = (event: unknown, ...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  vi.spyOn(ipcMain, 'handle').mockImplementation((channel, handler) => {
    handlers.set(channel, handler as Handler);
  });
  registerCoworkSessionIpc(deps);
  registerCoworkSessionAdminIpc(deps);
  registerCoworkQueueIpc(deps);
  registerCoworkConfigIpc(deps);
  const invoke = (definition: { channel: string }, ...args: unknown[]) =>
    handlers.get(definition.channel)!({}, ...args);
  return { store, id, runtime, invoke, deps };
}

test('real IPC contracts reject targeting automation records through start, continue and queued controls', async () => {
  const f = fixture();
  for (const forged of [
    { source: CoworkSessionSource.Scheduled },
    { sessionId: f.id },
    { id: f.id },
  ]) {
    await expect(
      f.invoke(coworkSessionLifecycleContract.startSession, { prompt: 'Run again', ...forged }),
    ).rejects.toThrow('invalid arguments');
  }
  expect(() => prepareCoworkSession(f.deps, { prompt: 'Run again' }, { sessionId: f.id })).toThrow(
    'read-only',
  );
  await expect(
    f.invoke(coworkSessionLifecycleContract.continueSession, {
      sessionId: f.id,
      prompt: 'Run again',
    }),
  ).resolves.toMatchObject({ success: false, error: expect.stringContaining('read-only') });
  for (const [definition, input] of [
    [coworkQueueContract.enqueuePendingMessage, { sessionId: f.id, text: 'Run again' }],
    [
      coworkQueueContract.updatePendingMessage,
      { sessionId: f.id, itemId: 'queued', text: 'Run again' },
    ],
    [coworkQueueContract.deletePendingMessage, { sessionId: f.id, itemId: 'queued' }],
    [coworkQueueContract.steerPendingMessage, { sessionId: f.id, itemId: 'queued' }],
    [coworkQueueContract.followUpPendingMessage, { sessionId: f.id, itemId: 'queued' }],
  ] as const) {
    await expect(f.invoke(definition, input)).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('read-only'),
    });
  }
  for (const method of [
    'continueSession',
    'startSession',
    'enqueuePendingMessage',
    'updatePendingMessage',
    'deletePendingMessage',
    'steerPendingMessage',
    'followUpPendingMessage',
  ] as const) {
    expect(f.runtime[method]).not.toHaveBeenCalled();
  }
  expect(f.store.countSessionMessages(f.id)).toBe(1);
});

test('model, permission, import and compaction cannot mutate a scheduled conversation', async () => {
  const f = fixture();
  const before = f.store.getSession(f.id);
  const config = f.store.getConfig();
  await expect(
    f.invoke(coworkSessionAdminContract.updateSessionModel, {
      sessionId: f.id,
      modelOverride: 'other/model',
    }),
  ).resolves.toMatchObject({ success: false, error: expect.stringContaining('read-only') });
  await expect(
    f.invoke(coworkSessionAdminContract.saveSession, { ...before, messages: [] }),
  ).resolves.toMatchObject({ success: false, error: expect.stringContaining('read-only') });
  await expect(f.invoke(coworkSessionAdminContract.compactSession, f.id)).resolves.toMatchObject({
    success: false,
  });
  await expect(
    f.invoke(coworkConfigContract.setConfig, {
      permissionModeBySession: { [f.id]: CoworkPermissionMode.AllowAll },
    }),
  ).resolves.toMatchObject({ success: false, error: expect.stringContaining('read-only') });
  expect(f.store.getSession(f.id)).toEqual(before);
  expect(f.store.getConfig()).toEqual(config);
  expect(f.runtime.setApprovalModeForSession).not.toHaveBeenCalled();
  expect(f.runtime.compactSession).not.toHaveBeenCalled();
});

test('scheduled history and attachments remain readable, and stopping its current run is allowed', async () => {
  const f = fixture();
  await expect(f.invoke(coworkSessionAdminContract.getSession, f.id)).resolves.toMatchObject({
    success: true,
    session: {
      source: CoworkSessionSource.Scheduled,
      messages: [{ content: 'Completed result with an attachment.' }],
    },
  });
  await expect(
    f.invoke(coworkSessionAdminContract.getSessionMessages, { sessionId: f.id }),
  ).resolves.toMatchObject({
    success: true,
    total: 1,
    messages: [
      { metadata: { fileAttachments: [{ name: 'report.csv', path: '/tmp/report.csv' }] } },
    ],
  });
  await expect(f.invoke(coworkSessionAdminContract.stopSession, f.id)).resolves.toEqual({
    success: true,
  });
  expect(f.runtime.stopSession).toHaveBeenCalledExactlyOnceWith(f.id);
});
