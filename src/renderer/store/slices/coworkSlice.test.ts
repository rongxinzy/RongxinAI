import { expect, test } from 'vitest';

import { CoworkSessionStatusValue } from '../../types/cowork';
import coworkReducer, {
  addMessage,
  addSession,
  clearCurrentSessionForWorkspaceChange,
  clearLoadingSessionId,
  setConfig,
  setCurrentSession,
  setCurrentSessionId,
  setLoadingSessionId,
  setSessions,
  updateCurrentSessionModelOverride,
  updateSessionStatus,
} from './coworkSlice';

const makeSession = (overrides: Partial<Parameters<typeof addSession>[0]> = {}) => ({
  id: 'session-1',
  title: 'Test Session',
  claudeSessionId: null,
  status: CoworkSessionStatusValue.Completed,
  pinned: false,
  cwd: '/tmp',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'local' as const,
  activeSkillIds: [],
  workspaceId: 'workspace-test',
  agentId: 'main',
  messages: [],
  messagesOffset: 0,
  totalMessages: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

test('defaults hidden OpenClaw session policy to thirty days', () => {
  const state = coworkReducer(undefined, { type: 'init' });

  expect(state.config.openClawSessionPolicy).toEqual({
    keepAlive: '30d',
  });
  expect(state.config.skipMissedJobs).toBe(true);
});

test('setConfig preserves loaded OpenClaw session policy', () => {
  const state = coworkReducer(
    undefined,
    setConfig({
      workingDirectory: '/tmp',
      systemPrompt: '',
      executionMode: 'local',
      agentEngine: 'openclaw',
      memoryEnabled: true,
      memoryImplicitUpdateEnabled: true,
      memoryLlmJudgeEnabled: false,
      memoryGuardLevel: 'strict',
      memoryUserMemoriesMaxItems: 12,
      skipMissedJobs: false,
      embeddingEnabled: false,
      embeddingProvider: 'openai',
      embeddingModel: '',
      embeddingLocalModelPath: '',
      embeddingVectorWeight: 0.7,
      embeddingRemoteBaseUrl: '',
      embeddingRemoteApiKey: '',
      openClawSessionPolicy: {
        keepAlive: '365d',
      },
    }),
  );

  expect(state.config.openClawSessionPolicy.keepAlive).toBe('365d');
});

test('updateCurrentSessionModelOverride only patches the active session', () => {
  const session = makeSession({ modelOverride: 'openai/gpt-5.4' });

  const activeState = coworkReducer(
    coworkReducer(undefined, addSession(session)),
    updateCurrentSessionModelOverride({
      sessionId: 'session-1',
      modelOverride: 'zhiyuan-server/qwen3.6-plus',
    }),
  );

  expect(activeState.currentSession?.modelOverride).toBe('zhiyuan-server/qwen3.6-plus');
  expect(activeState.currentSession?.updatedAt).toBe(1);

  const ignoredState = coworkReducer(
    activeState,
    updateCurrentSessionModelOverride({
      sessionId: 'session-2',
      modelOverride: 'moonshot/kimi-k2.6',
    }),
  );

  expect(ignoredState.currentSession?.modelOverride).toBe('zhiyuan-server/qwen3.6-plus');
});

test('addSession preserves the agent id in session summaries', () => {
  const state = coworkReducer(
    undefined,
    addSession(
      makeSession({
        id: 'session-agent-2',
        agentId: 'agent-2',
      }),
    ),
  );

  expect(state.sessions[0].agentId).toBe('agent-2');
});

test('setCurrentSession preserves the agent id when inserting a summary', () => {
  const state = coworkReducer(
    undefined,
    setCurrentSession(
      makeSession({
        id: 'session-agent-3',
        agentId: 'agent-3',
      }),
    ),
  );

  expect(state.sessions[0].agentId).toBe('agent-3');
});

test('clearing an earlier session load keeps the latest session loading', () => {
  const loadingLatestSession = coworkReducer(
    coworkReducer(undefined, setLoadingSessionId('session-1')),
    setLoadingSessionId('session-2'),
  );

  const afterEarlierLoadCompletes = coworkReducer(
    loadingLatestSession,
    clearLoadingSessionId('session-1'),
  );

  expect(afterEarlierLoadCompletes.loadingSessionId).toBe('session-2');
  expect(
    coworkReducer(afterEarlierLoadCompletes, clearLoadingSessionId('session-2')).loadingSessionId,
  ).toBeNull();
});

test('workspace changes preserve a pending target session load', () => {
  const state = coworkReducer(
    coworkReducer(undefined, addSession(makeSession())),
    setLoadingSessionId('session-2'),
  );

  const clearedState = coworkReducer(state, clearCurrentSessionForWorkspaceChange());

  expect(clearedState.currentSession).toBeNull();
  expect(clearedState.currentSessionId).toBeNull();
  expect(clearedState.loadingSessionId).toBe('session-2');
});

test('updateSessionStatus marks completed inactive sessions unread', () => {
  const state = coworkReducer(
    undefined,
    setSessions([
      {
        id: 'session-1',
        title: 'Completed task',
        status: CoworkSessionStatusValue.Running,
        pinned: false,
        agentId: 'main',
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );

  const completedState = coworkReducer(
    state,
    updateSessionStatus({
      sessionId: 'session-1',
      status: CoworkSessionStatusValue.Completed,
    }),
  );

  expect(completedState.unreadSessionIds).toEqual(['session-1']);
});

test('updateSessionStatus does not mark the active completed session unread', () => {
  const state = coworkReducer(
    coworkReducer(
      undefined,
      setSessions([
        {
          id: 'session-1',
          title: 'Active task',
          status: CoworkSessionStatusValue.Running,
          pinned: false,
          agentId: 'main',
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ),
    setCurrentSessionId('session-1'),
  );

  const completedState = coworkReducer(
    state,
    updateSessionStatus({
      sessionId: 'session-1',
      status: CoworkSessionStatusValue.Completed,
    }),
  );

  expect(completedState.unreadSessionIds).toEqual([]);
});

test('updateSessionStatus marks the active session as streaming while it is running', () => {
  const state = coworkReducer(undefined, addSession(makeSession()));

  const runningState = coworkReducer(
    state,
    updateSessionStatus({
      sessionId: 'session-1',
      status: CoworkSessionStatusValue.Running,
    }),
  );

  expect(runningState.currentSession?.status).toBe(CoworkSessionStatusValue.Running);
  expect(runningState.streamingSessionIds).toEqual(['session-1']);
});

test('a stale completed snapshot does not clear a tracked live session stream', () => {
  const runningState = coworkReducer(
    coworkReducer(undefined, addSession(makeSession())),
    updateSessionStatus({ sessionId: 'session-1', status: CoworkSessionStatusValue.Running }),
  );

  const reloadedState = coworkReducer(
    runningState,
    setCurrentSession(makeSession({ status: CoworkSessionStatusValue.Completed })),
  );

  expect(reloadedState.streamingSessionIds).toEqual(['session-1']);
  expect(reloadedState.currentSession?.status).toBe(CoworkSessionStatusValue.Running);
});

test('keeps streaming messages when another session is selected', () => {
  const sessionOne = makeSession({ id: 'session-1', status: CoworkSessionStatusValue.Running });
  const sessionTwo = makeSession({ id: 'session-2' });
  const streamingState = coworkReducer(undefined, addSession(sessionOne));
  const switchedState = coworkReducer(streamingState, setCurrentSession(sessionTwo));
  const updatedState = coworkReducer(
    switchedState,
    addMessage({
      sessionId: 'session-1',
      message: {
        id: 'assistant-1',
        type: 'assistant',
        content: 'still streaming',
        timestamp: 2,
      },
    }),
  );

  const restoredState = coworkReducer(updatedState, setCurrentSession(sessionOne));

  expect(restoredState.currentSession?.messages).toHaveLength(1);
  expect(restoredState.currentSession?.messages[0]?.content).toBe('still streaming');
});
