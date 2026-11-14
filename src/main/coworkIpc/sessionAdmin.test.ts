import { beforeEach, expect, test, vi } from 'vitest';

import { registerCoworkSessionAdminIpc } from './sessionAdmin';
import { forgetCoworkSession } from '../appBootstrap/coworkSessionImages';

const captured = vi.hoisted(() => ({ handlers: {} as Record<string, unknown> }));

vi.mock('../ipc/handleIpcContract', () => ({
  handleIpcContract: (_contract: unknown, handlers: Record<string, unknown>) => {
    captured.handlers = handlers;
  },
}));

vi.mock('../appBootstrap/coworkSessionImages', () => ({
  forgetCoworkSession: vi.fn(),
  getCoworkImageRoot: () => '/tmp',
  scheduleBackgroundMaterialize: vi.fn(),
}));

beforeEach(() => vi.mocked(forgetCoworkSession).mockReset());

test('single and batch deletion both persist finalization before deleting sessions', async () => {
  const deleted: string[][] = [];
  const finalized: string[][] = [];
  const store = {
    getSessionFinalizationSnapshot: (id: string) => ({
      id,
      title: `title-${id}`,
      cwd: '/work',
      lastAssistantContent: `answer-${id}`,
    }),
    deleteSessions: vi.fn((ids: string[]) => {
      deleted.push(ids);
    }),
  };
  const memory = {
    finalizeSessionsForDeletion: vi.fn(
      (sessions: Array<{ sessionId: string; summary: string }>, deleteSessions: () => void) => {
        finalized.push(sessions.map(session => session.sessionId));
        expect(sessions.every(session => session.summary.includes('answer-'))).toBe(true);
        deleteSessions();
      },
    ),
  };
  registerCoworkSessionAdminIpc({
    getCoworkStore: () => store as never,
    getPiRuntimeAdapter: () => ({ getProjectMemoryService: () => memory }) as never,
  });
  const deleteSession = captured.handlers.deleteSession as (
    event: unknown,
    id: string,
  ) => Promise<{ success: boolean }>;
  const deleteSessions = captured.handlers.deleteSessions as (
    event: unknown,
    ids: string[],
  ) => Promise<{ success: boolean }>;

  await expect(deleteSession({}, 'session-1')).resolves.toEqual({ success: true });
  await expect(deleteSessions({}, ['session-2', 'session-3'])).resolves.toEqual({ success: true });
  expect(finalized).toEqual([['session-1'], ['session-2', 'session-3']]);
  expect(deleted).toEqual([['session-1'], ['session-2', 'session-3']]);
});

test.each(['deleteSession', 'deleteSessions'])(
  '%s awaits runtime removal and preserves product rows when removal fails',
  async method => {
    const store = {
      getSessionFinalizationSnapshot: () => null,
      deleteSessions: vi.fn(),
    };
    registerCoworkSessionAdminIpc({
      getCoworkStore: () => store as never,
      getPiRuntimeAdapter: () => ({ getProjectMemoryService: () => null }) as never,
    });
    const handler = captured.handlers[method] as (
      event: unknown,
      input: string | string[],
    ) => Promise<{ success: boolean; error?: string }>;
    let finish!: () => void;
    vi.mocked(forgetCoworkSession).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve;
      }),
    );
    const input = method === 'deleteSession' ? 'scheduled-1' : ['scheduled-1', 'scheduled-2'];
    const pending = handler({}, input);
    expect(forgetCoworkSession).toHaveBeenCalledWith('scheduled-1');
    expect(store.deleteSessions).not.toHaveBeenCalled();
    finish();
    await expect(pending).resolves.toEqual({ success: true });
    expect(store.deleteSessions).toHaveBeenCalledExactlyOnceWith(
      method === 'deleteSession' ? ['scheduled-1'] : input,
    );

    store.deleteSessions.mockClear();
    vi.mocked(forgetCoworkSession).mockRejectedValueOnce(
      new Error('Native task cancellation failed.'),
    );
    await expect(handler({}, input)).resolves.toEqual({
      success: false,
      error: 'Native task cancellation failed.',
    });
    expect(store.deleteSessions).not.toHaveBeenCalled();
  },
);

test('message pagination never reads rows belonging to a retired session source', async () => {
  const store = {
    getSession: vi.fn(() => null),
    countSessionMessages: vi.fn(),
    getPagedSessionMessages: vi.fn(),
  };
  registerCoworkSessionAdminIpc({
    getCoworkStore: () => store as never,
    getPiRuntimeAdapter: () => null as never,
  });
  const getMessages = captured.handlers.getSessionMessages as (
    event: unknown,
    input: { sessionId: string; offset: number },
  ) => Promise<unknown>;
  await expect(getMessages({}, { sessionId: 'retired-im', offset: 10 })).resolves.toEqual({
    success: true,
    messages: [],
    offset: 10,
    total: 0,
  });
  expect(store.countSessionMessages).not.toHaveBeenCalled();
  expect(store.getPagedSessionMessages).not.toHaveBeenCalled();
});
