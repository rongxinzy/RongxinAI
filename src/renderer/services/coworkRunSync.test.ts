// @vitest-environment jsdom
import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { afterEach, expect, test, vi } from 'vitest';
import {
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../shared/cowork/constants';
import { CoworkRunPhase, type CoworkRunSnapshot } from '../../shared/cowork/runState';
import coworkReducer, { setCurrentSession, addMessage } from '../store/slices/coworkSlice';
import runReducer, { expectRunStart } from '../store/slices/coworkRunSlice';
import type { CoworkSession } from '../types/cowork';
import { CoworkRunSync } from './coworkRunSync';

vi.mock('../store', () => ({
  store: {
    getState: () => testStore.getState(),
    dispatch: (action: UnknownAction) => testStore.dispatch(action),
  },
}));
const makeStore = () =>
  configureStore({ reducer: { cowork: coworkReducer, coworkRun: runReducer } });
let testStore = makeStore();
const session: CoworkSession = {
  id: 'a',
  title: 'test',
  claudeSessionId: null,
  status: CoworkSessionStatus.Running,
  mode: CoworkSessionMode.Work,
  pinned: false,
  cwd: '/test',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'local',
  activeSkillIds: [],
  workspaceId: 'workspace',
  agentId: 'main',
  source: CoworkSessionSource.Manual,
  messages: [{ id: 'old', type: 'user', content: 'old', timestamp: 1 }],
  messagesOffset: 0,
  totalMessages: 1,
  createdAt: 1,
  updatedAt: 1,
};
const snapshot: CoworkRunSnapshot = {
  sessionId: 'a',
  runId: 'run',
  sequence: 1,
  running: true,
  phase: CoworkRunPhase.Tool,
  startedAt: 10,
  confirmedAt: 20,
  lastProgressAt: 10,
};
afterEach(() => {
  vi.unstubAllGlobals();
  testStore = makeStore();
});

test('recovery preserves newer live messages, older loaded history and the selected session', async () => {
  testStore.dispatch(setCurrentSession(session));
  let resolveSession: (value: { success: boolean; session: CoworkSession }) => void = () => {};
  const getSession = vi.fn(
    () =>
      new Promise(resolve => {
        resolveSession = resolve;
      }),
  );
  const getRunSnapshot = vi.fn().mockResolvedValue({ success: true, snapshot, running: true });
  vi.stubGlobal('window', { electron: { cowork: { getSession, getRunSnapshot } } });
  const sync = new CoworkRunSync(vi.fn());
  const recovery = sync.recover('a');
  await vi.waitFor(() => expect(getSession).toHaveBeenCalledOnce());
  testStore.dispatch(
    addMessage({
      sessionId: 'a',
      message: { id: 'new', type: 'assistant', content: 'new live content', timestamp: 3 },
    }),
  );
  resolveSession({
    success: true,
    session: {
      ...session,
      messagesOffset: 10,
      messages: [{ id: 'missed', type: 'assistant', content: 'missed', timestamp: 2 }],
    },
  });
  await recovery;
  expect(testStore.getState().cowork.currentSession?.messages.map(message => message.id)).toEqual([
    'old',
    'missed',
    'new',
  ]);
  expect(testStore.getState().cowork.currentSessionId).toBe('a');
  expect(getRunSnapshot).toHaveBeenLastCalledWith('a', true);
});

test('direct Chat recovery never overwrites the provider stream', async () => {
  testStore.dispatch(setCurrentSession({ ...session, mode: CoworkSessionMode.Chat }));
  const getSession = vi.fn();
  vi.stubGlobal('window', {
    electron: {
      cowork: {
        getSession,
        getRunSnapshot: vi
          .fn()
          .mockResolvedValue({ success: true, snapshot: null, running: false }),
      },
    },
  });
  await new CoworkRunSync(vi.fn()).recover('a');
  expect(getSession).not.toHaveBeenCalled();
  expect(testStore.getState().cowork.streamingSessionIds).toContain('a');
});

test('the previous completed run cannot stop a new prompt during initialization', () => {
  testStore.dispatch(setCurrentSession(session));
  testStore.dispatch(expectRunStart({ sessionId: 'a', startedAt: 100 }));
  const sync = new CoworkRunSync(vi.fn());
  sync.receive({ ...snapshot, running: false, phase: CoworkRunPhase.Completed });
  expect(testStore.getState().cowork.streamingSessionIds).toContain('a');
  sync.receive({ ...snapshot, runId: 'new', startedAt: 101 });
  expect(testStore.getState().coworkRun.awaitingSince.a).toBeUndefined();
  sync.receive({
    ...snapshot,
    runId: 'new',
    startedAt: 101,
    sequence: 2,
    running: false,
    phase: CoworkRunPhase.Completed,
  });
  expect(testStore.getState().cowork.streamingSessionIds).not.toContain('a');
});
