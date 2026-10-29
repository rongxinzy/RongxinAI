import { expect, test, vi } from 'vitest';

import { registerCoworkSessionAdminIpc } from './sessionAdmin';

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
    getIMGatewayManager: () => undefined,
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
