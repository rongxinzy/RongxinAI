import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { CoworkSessionMode, CoworkSessionSource } from '../../shared/cowork/constants';
import coworkReducer, { addSession } from '../store/slices/coworkSlice';
import { CoworkSessionStatusValue, type CoworkSession } from '../types/cowork';
import { coworkService } from './cowork';
import { workspaceService } from './workspace';

vi.mock('../store', () => ({
  store: {
    getState: () => testStore.getState(),
    dispatch: (action: UnknownAction) => testStore.dispatch(action),
  },
}));
vi.mock('./workspace', () => ({
  workspaceService: {
    isWorkspaceApiAvailable: () => true,
    promoteWorkspace: vi.fn(),
    refreshWorkspaces: vi.fn(),
  },
}));
vi.mock('./i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('./coworkSessionRenderPreparation', () => ({ prepareCoworkSessionRender: vi.fn() }));

const makeStore = () =>
  configureStore({
    reducer: {
      cowork: coworkReducer,
      workspace: () => ({ currentWorkspaceId: 'workspace-1' }),
    },
  });
let testStore: ReturnType<typeof makeStore>;
const startSession = vi.fn();
const temporarySessionId = 'temp-startup';
const makeSession = (id: string, mode: CoworkSession['mode']): CoworkSession => ({
  id,
  title: 'Same title',
  claudeSessionId: null,
  status: CoworkSessionStatusValue.Running,
  mode,
  pinned: false,
  cwd: '/workspace',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'local',
  activeSkillIds: [],
  workspaceId: 'workspace-1',
  agentId: 'main',
  source: CoworkSessionSource.Manual,
  messages: [{ id: 'user-1', type: 'user', content: 'Create a document', timestamp: 1 }],
  messagesOffset: 0,
  totalMessages: 1,
  createdAt: 1,
  updatedAt: 1,
});
const listIds = () => {
  const state = testStore.getState().cowork;
  return [...state.sessions, ...state.chatSessions].map(session => session.id);
};

beforeEach(() => {
  vi.clearAllMocks();
  testStore = makeStore();
  vi.stubGlobal('window', {
    electron: { cowork: { startSession } },
    dispatchEvent: vi.fn(),
  });
  vi.mocked(workspaceService.refreshWorkspaces).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

for (const mode of [CoworkSessionMode.Work, CoworkSessionMode.Chat]) {
  test(`atomically replaces the ${mode} placeholder even while workspace refresh is pending`, async () => {
    const temporary = makeSession(temporarySessionId, mode);
    const real = makeSession('real-session', mode);
    testStore.dispatch(addSession(temporary));
    const snapshots: string[][] = [];
    const unsubscribe = testStore.subscribe(() => snapshots.push(listIds()));
    let finishRefresh: () => void = () => {};
    vi.mocked(workspaceService.refreshWorkspaces).mockImplementation(
      () =>
        new Promise(resolve => {
          finishRefresh = resolve;
        }),
    );
    startSession.mockResolvedValue({ success: true, session: real });
    const pending = coworkService.startSession(
      { prompt: 'Create a document', mode },
      temporarySessionId,
    );
    await vi.waitFor(() => expect(workspaceService.refreshWorkspaces).toHaveBeenCalledOnce());
    expect(listIds()).toEqual([real.id]);
    expect(snapshots.every(ids => ids.length === 1)).toBe(true);
    const state = testStore.getState().cowork;
    expect(state.currentSessionId).toBe(real.id);
    expect(state.currentSession?.messages).toEqual(real.messages);
    expect(state.streamingSessionIds).toEqual([real.id]);
    expect(state.streamingSessions[temporarySessionId]).toBeUndefined();
    expect(state.streamingSessions[real.id]?.messages).toEqual(real.messages);
    expect(startSession.mock.calls[0][0]).not.toHaveProperty('temporarySessionId');
    finishRefresh();
    await expect(pending).resolves.toEqual({ session: real });
    unsubscribe();
  });
}

test('retains the placeholder and its initial message when startup fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const temporary = makeSession(temporarySessionId, CoworkSessionMode.Work);
  testStore.dispatch(addSession(temporary));
  startSession.mockResolvedValue({ success: false, error: 'Startup failed' });
  await expect(
    coworkService.startSession({ prompt: 'Create a document' }, temporarySessionId),
  ).resolves.toEqual({ session: null, error: 'Startup failed' });
  expect(listIds()).toEqual([temporarySessionId]);
  expect(testStore.getState().cowork.currentSession?.messages).toEqual(temporary.messages);
  expect(workspaceService.refreshWorkspaces).not.toHaveBeenCalled();
});

test('does not remove a successful replacement if workspace refresh rejects', async () => {
  testStore.dispatch(addSession(makeSession(temporarySessionId, CoworkSessionMode.Work)));
  const real = makeSession('real-session', CoworkSessionMode.Work);
  startSession.mockResolvedValue({ success: true, session: real });
  vi.mocked(workspaceService.refreshWorkspaces).mockRejectedValue(new Error('Refresh failed'));
  await expect(
    coworkService.startSession({ prompt: 'Create a document' }, temporarySessionId),
  ).rejects.toThrow('Refresh failed');
  expect(listIds()).toEqual([real.id]);
  expect(testStore.getState().cowork.currentSessionId).toBe(real.id);
});

test('replaces only the specified placeholder and preserves other sessions and streams', () => {
  testStore.dispatch(addSession(makeSession('other-session', CoworkSessionMode.Chat)));
  testStore.dispatch(addSession(makeSession(temporarySessionId, CoworkSessionMode.Work)));
  const real = makeSession('real-session', CoworkSessionMode.Work);
  testStore.dispatch(addSession(real, temporarySessionId));
  expect(listIds()).toEqual([real.id, 'other-session']);
  expect(testStore.getState().cowork.streamingSessionIds).toEqual(['other-session', real.id]);
});

test('keeps existing add and same-identity direct-chat save behavior', () => {
  const session = makeSession('direct-session', CoworkSessionMode.Chat);
  testStore.dispatch(addSession(session));
  testStore.dispatch(addSession({ ...session, title: 'Updated title' }, session.id));
  expect(listIds()).toEqual([session.id]);
  expect(testStore.getState().cowork.currentSession?.title).toBe('Updated title');
  expect(testStore.getState().cowork.streamingSessionIds).toEqual([session.id]);
});

test('handles an already-removed placeholder without dropping the real session', () => {
  const real = makeSession('real-session', CoworkSessionMode.Work);
  testStore.dispatch(addSession(real, temporarySessionId));
  expect(listIds()).toEqual([real.id]);
  expect(testStore.getState().cowork.currentSessionId).toBe(real.id);
});

test('passes the local placeholder identity from the view instead of deleting it after refresh', () => {
  const source = readFileSync(
    new URL('../components/cowork/CoworkView.tsx', import.meta.url),
    'utf8',
  );
  const startup = source.slice(source.indexOf('await coworkService.startSession('));
  expect(startup).toMatch(/fileAttachments,\s*},\s*tempSessionId\s*,?\s*\)/);
  expect(source).not.toContain('dispatch(deleteSession(tempSessionId))');
});
