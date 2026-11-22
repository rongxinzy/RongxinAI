import { expect, test, vi } from 'vitest';

import {
  CoworkMessageType,
  CoworkSessionMode,
  CoworkSessionStatus,
} from '../../shared/cowork/constants';
import { createCoworkStoreHarness } from '../coworkStore/coworkStore.testHarness';
import { IMStore } from '../im/imStore';
import { initializeIMSchema } from '../im/schema';
import { registerCoworkSessionAdminIpc } from './sessionAdmin';

const captured = vi.hoisted(() => ({ handlers: {} as Record<string, unknown> }));

vi.mock('../ipc/handleIpcContract', () => ({
  handleIpcContract: (_contract: unknown, handlers: Record<string, unknown>) => {
    captured.handlers = handlers;
  },
}));

vi.mock('../appBootstrap/coworkSessionImages', () => ({
  scheduleBackgroundMaterialize: vi.fn(),
}));

test('Work detail uses the channel mapping and both reads use Pi liveness for a legacy running row', async () => {
  const { db, store } = createCoworkStoreHarness();
  const isSessionRunning = vi.fn(() => false);
  try {
    initializeIMSchema(db);
    const im = new IMStore(db);
    const { id } = store.createSession('Old Work session', '/tmp/work-status');
    db.prepare('UPDATE cowork_sessions SET status = ?, updated_at = 1 WHERE id = ?').run(
      CoworkSessionStatus.Running,
      id,
    );
    registerCoworkSessionAdminIpc({
      getCoworkStore: () => store,
      getPiRuntimeAdapter: vi
        .fn()
        .mockReturnValue({ isSessionRunning, getLiveStreamTexts: () => [] }),
      getIMStore: () => im,
      deleteSessions: vi.fn(),
    });
    const get = captured.handlers.getSession as (event: unknown, id: string) => Promise<unknown>;
    const list = captured.handlers.listSessions as (event: unknown) => Promise<unknown>;
    for (const status of [CoworkSessionStatus.Idle, CoworkSessionStatus.Running]) {
      isSessionRunning.mockReturnValue(status === CoworkSessionStatus.Running);
      const session = { id, status, updatedAt: 1 };
      await expect(get({}, id)).resolves.toMatchObject({
        success: true,
        session: { ...session, remoteManaged: false },
      });
      await expect(list({})).resolves.toMatchObject({ success: true, sessions: [session] });
    }
    im.createSessionMapping('fixture-channel', 'weixin', id);
    await expect(get({}, id)).resolves.toMatchObject({
      success: true,
      session: { id, remoteManaged: true },
    });
    expect(captured.handlers).not.toHaveProperty('remoteManaged');
  } finally {
    db.close();
  }
});

test('detail and history expose streaming only for messages still owned by Pi', async () => {
  const { db, store } = createCoworkStoreHarness();
  try {
    const { id } = store.createSession('Work after restart', '/tmp/work-stream-state');
    const checkpoint = (content: string) =>
      store.messages.addMessage(id, {
        type: CoworkMessageType.Assistant,
        content,
        metadata: { isStreaming: true },
      });
    const old = checkpoint('Interrupted answer');
    const current = checkpoint('Current answer');
    const isSessionRunning = vi.fn(() => false);
    const getLiveStreamTexts = vi.fn(() => [{ messageId: current.id }]);
    registerCoworkSessionAdminIpc({
      getCoworkStore: () => store,
      getPiRuntimeAdapter: vi.fn().mockReturnValue({ isSessionRunning, getLiveStreamTexts }),
      getIMStore: vi.fn().mockReturnValue({ getSessionMappingByCoworkSessionId: () => null }),
      deleteSessions: vi.fn(),
    });
    const get = captured.handlers.getSession as (event: unknown, id: string) => Promise<unknown>;
    const page = captured.handlers.getSessionMessages as (
      event: unknown,
      options: { sessionId: string },
    ) => Promise<unknown>;
    for (const running of [false, true]) {
      isSessionRunning.mockReturnValue(running);
      const messages = [
        { id: old.id, content: old.content, metadata: { isStreaming: false } },
        { id: current.id, content: current.content, metadata: { isStreaming: running } },
      ];
      await expect(get({}, id)).resolves.toMatchObject({ success: true, session: { messages } });
      await expect(page({}, { sessionId: id })).resolves.toMatchObject({ success: true, messages });
    }
    expect(store.messages.getMessage(id, old.id)?.metadata?.isStreaming).toBe(true);
  } finally {
    db.close();
  }
});

test('paginates a filtered list with one query and projects only returned sessions', async () => {
  const { db, store } = createCoworkStoreHarness();
  const liveness = vi.fn(() => false);
  try {
    const first = store.createSession('Pinned', '/tmp/paged-work');
    const second = store.createSession('Other work', '/tmp/paged-work');
    store.createSession(
      'Chat',
      '/tmp/paged-work',
      '',
      'local',
      [],
      'main',
      '',
      CoworkSessionMode.Chat,
    );
    store.setSessionPinned(first.id, true);
    registerCoworkSessionAdminIpc({
      getCoworkStore: () => store,
      getPiRuntimeAdapter: vi.fn().mockReturnValue({ isSessionRunning: liveness }),
      getIMStore: vi.fn(),
      deleteSessions: vi.fn(),
    });
    const list = captured.handlers.listSessions as (
      event: unknown,
      options: object,
    ) => Promise<unknown>;
    const filters = { workspaceId: first.workspaceId, mode: CoworkSessionMode.Work, limit: 1 };
    const statements = vi.spyOn(db, 'prepare');
    await expect(list({}, filters)).resolves.toMatchObject({
      success: true,
      sessions: [{ id: first.id }],
      hasMore: true,
    });
    expect(statements).toHaveBeenCalledOnce();
    expect(liveness).toHaveBeenCalledExactlyOnceWith(first.id);
    await expect(list({}, { ...filters, offset: 1 })).resolves.toMatchObject({
      sessions: [{ id: second.id }],
      hasMore: false,
    });
    await expect(list({}, { ...filters, offset: 2 })).resolves.toMatchObject({
      sessions: [],
      hasMore: false,
    });
    await expect(list({}, { ...filters, limit: 0 })).resolves.toMatchObject({
      sessions: [],
      hasMore: true,
    });
    await expect(list({}, { ...filters, limit: -1 })).resolves.toMatchObject({
      sessions: [{ id: first.id }, { id: second.id }],
      hasMore: false,
    });
  } finally {
    db.close();
  }
});

test('single and batch IPC deletion use the same owner and report transaction failures', async () => {
  const remove = vi.fn<(ids: string[]) => Promise<void>>().mockResolvedValue(undefined);
  registerCoworkSessionAdminIpc({
    getCoworkStore: vi.fn(),
    getPiRuntimeAdapter: vi.fn(),
    getIMStore: vi.fn(),
    deleteSessions: remove,
  });
  const deleteSession = captured.handlers.deleteSession as (
    event: unknown,
    id: string,
  ) => Promise<{ success: boolean }>;
  const deleteSessions = captured.handlers.deleteSessions as (
    event: unknown,
    ids: string[],
  ) => Promise<{ success: boolean }>;

  await expect(deleteSession({}, 'one')).resolves.toEqual({ success: true });
  const cleanup = Promise.withResolvers<void>();
  remove.mockReturnValueOnce(cleanup.promise);
  const finished = vi.fn();
  const deletion = deleteSessions({}, ['two', 'three']).then(result => {
    finished();
    return result;
  });
  await Promise.resolve();
  expect(finished).not.toHaveBeenCalled();
  cleanup.resolve();
  await expect(deletion).resolves.toEqual({ success: true });
  expect(remove.mock.calls).toEqual([[['one']], [['two', 'three']]]);

  remove.mockRejectedValue(new Error('session deletion rejected'));
  const result = { success: false, error: 'session deletion rejected' };
  await expect(deleteSession({}, 'one')).resolves.toEqual(result);
  await expect(deleteSessions({}, ['two', 'three'])).resolves.toEqual(result);
});
