import { expect, test } from 'vitest';

import { CoworkPermissionMode, CoworkPermissionOrigin } from '../../../shared/cowork/constants';
import {
  CoworkToolActivityEventType,
  CoworkToolActivityPhase,
} from '../../../shared/cowork/toolActivity';
import { CoworkSessionStatusValue } from '../../types/cowork';
import coworkReducer, {
  addMessage,
  addSession,
  clearCurrentSessionForWorkspaceChange,
  clearPendingPermissionsForSession,
  clearLoadingSessionId,
  enqueuePendingPermission,
  setConfig,
  setCurrentSession,
  setCurrentSessionId,
  setLoadingSessionId,
  setChatSessions,
  setSessions,
  updateCurrentSessionModelOverride,
  updateConfig,
  updateMessageContents,
  updateToolActivity,
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
      permissionMode: CoworkPermissionMode.Ask,
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
      modelOverride: 'deepseek/qwen3.6-plus',
    }),
  );

  expect(activeState.currentSession?.modelOverride).toBe('deepseek/qwen3.6-plus');
  expect(activeState.currentSession?.updatedAt).toBe(1);

  const ignoredState = coworkReducer(
    activeState,
    updateCurrentSessionModelOverride({
      sessionId: 'session-2',
      modelOverride: 'moonshot/kimi-k2.6',
    }),
  );

  expect(ignoredState.currentSession?.modelOverride).toBe('deepseek/qwen3.6-plus');
});

test('changing a session permission mode preserves pending approvals from every session', () => {
  const withPermissions = coworkReducer(
    coworkReducer(
      undefined,
      enqueuePendingPermission({
        origin: CoworkPermissionOrigin.PiWorkbench,
        sessionId: 'session-a',
        requestId: 'request-a',
        toolName: 'write',
        toolInput: {},
        toolUseId: null,
      }),
    ),
    enqueuePendingPermission({
      origin: CoworkPermissionOrigin.PiWorkbench,
      sessionId: 'session-b',
      requestId: 'request-b',
      toolName: 'bash',
      toolInput: {},
      toolUseId: null,
    }),
  );

  const next = coworkReducer(
    withPermissions,
    updateConfig({
      permissionModeBySession: {
        'session-a': CoworkPermissionMode.AllowAll,
      },
    }),
  );

  expect(next.pendingPermissions.map(permission => permission.requestId)).toEqual([
    'request-a',
    'request-b',
  ]);
});

test('session interruption clears only approvals owned by that session', () => {
  const withPermissions = coworkReducer(
    coworkReducer(
      undefined,
      enqueuePendingPermission({
        origin: CoworkPermissionOrigin.PiWorkbench,
        sessionId: 'session-a',
        requestId: 'request-a',
        toolName: 'write',
        toolInput: {},
        toolUseId: null,
      }),
    ),
    enqueuePendingPermission({
      origin: CoworkPermissionOrigin.PiWorkbench,
      sessionId: 'session-b',
      requestId: 'request-b',
      toolName: 'bash',
      toolInput: {},
      toolUseId: null,
    }),
  );

  const next = coworkReducer(withPermissions, clearPendingPermissionsForSession('session-a'));

  expect(next.pendingPermissions.map(permission => permission.requestId)).toEqual(['request-b']);
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

test('chat sessions use the chat cache without invalidating work sessions', () => {
  const chatState = coworkReducer(
    undefined,
    addSession(
      makeSession({
        id: 'chat-session-1',
        mode: 'chat',
      }),
    ),
  );

  expect(chatState.sessions).toEqual([]);
  expect(chatState.chatSessions.map(session => session.id)).toEqual(['chat-session-1']);

  const loadedState = coworkReducer(
    coworkReducer(chatState, setSessions([makeSession({ id: 'work-session-1' })])),
    setChatSessions(chatState.chatSessions),
  );

  expect(loadedState.sessions.map(session => session.id)).toEqual(['work-session-1']);
  expect(loadedState.chatSessions.map(session => session.id)).toEqual(['chat-session-1']);
  expect(loadedState.chatSessionsLoaded).toBe(true);
});

test('refreshing chat sessions keeps the work session array stable', () => {
  const workState = coworkReducer(undefined, setSessions([makeSession({ id: 'work-session-1' })]));
  const chatState = coworkReducer(
    workState,
    setChatSessions([makeSession({ id: 'chat-session-1', mode: 'chat' })]),
  );

  expect(chatState.sessions).toBe(workState.sessions);
  expect(chatState.chatSessions).not.toBe(workState.chatSessions);
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

test('merges complete loaded history into a tracked streaming session', () => {
  const recentMessage = {
    id: 'assistant-live',
    type: 'assistant' as const,
    content: 'partial',
    timestamp: 3,
  };
  const runningSession = makeSession({
    status: CoworkSessionStatusValue.Running,
    messages: [recentMessage],
    messagesOffset: 30,
    totalMessages: 31,
  });
  const streamingState = coworkReducer(undefined, addSession(runningSession));
  const updatedState = coworkReducer(
    streamingState,
    updateMessageContents([
      {
        sessionId: runningSession.id,
        messageId: recentMessage.id,
        content: 'complete live response',
      },
    ]),
  );
  const completeHistory = makeSession({
    status: CoworkSessionStatusValue.Completed,
    messages: [
      { id: 'user-old', type: 'user', content: 'old question', timestamp: 1 },
      { id: 'assistant-old', type: 'assistant', content: 'old answer', timestamp: 2 },
      recentMessage,
    ],
    messagesOffset: 0,
    totalMessages: 3,
  });

  const restoredState = coworkReducer(updatedState, setCurrentSession(completeHistory));

  expect(restoredState.currentSession?.messages.map(message => message.id)).toEqual([
    'user-old',
    'assistant-old',
    'assistant-live',
  ]);
  expect(restoredState.currentSession?.messages[2]?.content).toBe('complete live response');
  expect(restoredState.currentSession?.messagesOffset).toBe(0);
  expect(restoredState.currentSession?.status).toBe(CoworkSessionStatusValue.Running);
});

test('tracks parallel transient tool activities by session and call id', () => {
  const runningState = coworkReducer(
    undefined,
    updateSessionStatus({ sessionId: 'session-1', status: CoworkSessionStatusValue.Running }),
  );
  const firstActivity = coworkReducer(
    runningState,
    updateToolActivity({
      sessionId: 'session-1',
      event: {
        type: CoworkToolActivityEventType.Upsert,
        activity: {
          toolCallId: 'read-1',
          phase: CoworkToolActivityPhase.Preparing,
          toolName: 'Read',
          updatedAt: 1,
        },
      },
    }),
  );
  const parallelActivity = coworkReducer(
    firstActivity,
    updateToolActivity({
      sessionId: 'session-1',
      event: {
        type: CoworkToolActivityEventType.Upsert,
        activity: {
          toolCallId: 'write-1',
          phase: CoworkToolActivityPhase.Preparing,
          toolName: 'Write',
          updatedAt: 2,
        },
      },
    }),
  );

  expect(Object.keys(parallelActivity.toolActivitiesBySession['session-1'])).toEqual([
    'read-1',
    'write-1',
  ]);
});

test('replaces transient activity with the persisted tool use message', () => {
  const activityState = coworkReducer(
    undefined,
    updateToolActivity({
      sessionId: 'session-1',
      event: {
        type: CoworkToolActivityEventType.Upsert,
        activity: {
          toolCallId: 'write-1',
          phase: CoworkToolActivityPhase.Preparing,
          toolName: 'Write',
          updatedAt: 1,
        },
      },
    }),
  );
  const toolUseState = coworkReducer(
    activityState,
    addMessage({
      sessionId: 'session-1',
      message: {
        id: 'tool-use-1',
        type: 'tool_use',
        content: 'Using tool: Write',
        timestamp: 2,
        metadata: { toolUseId: 'write-1', toolName: 'Write' },
      },
    }),
  );

  expect(toolUseState.toolActivitiesBySession['session-1']).toBeUndefined();
});

test('clears transient tool activities when a session stops running', () => {
  const activityState = coworkReducer(
    undefined,
    updateToolActivity({
      sessionId: 'session-1',
      event: {
        type: CoworkToolActivityEventType.Upsert,
        activity: {
          toolCallId: 'read-1',
          phase: CoworkToolActivityPhase.Running,
          updatedAt: 1,
        },
      },
    }),
  );
  const completedState = coworkReducer(
    activityState,
    updateSessionStatus({
      sessionId: 'session-1',
      status: CoworkSessionStatusValue.Completed,
    }),
  );

  expect(completedState.toolActivitiesBySession['session-1']).toBeUndefined();
});

test('applies a batched stream frame without touching summaries or unread state', () => {
  const session = makeSession({
    id: 'session-1',
    status: CoworkSessionStatusValue.Running,
    updatedAt: 5,
    messages: [
      { id: 'thinking', type: 'assistant', content: 'partial thinking', timestamp: 2 },
      { id: 'answer', type: 'assistant', content: 'partial answer', timestamp: 3 },
    ],
  });
  const withSession = coworkReducer(undefined, addSession(session));
  const unreadBefore = withSession.unreadSessionIds;

  const updated = coworkReducer(
    withSession,
    updateMessageContents([
      { sessionId: 'session-1', messageId: 'thinking', content: 'full thinking' },
      { sessionId: 'session-1', messageId: 'answer', content: 'full answer' },
    ]),
  );

  expect(updated.currentSession?.messages.map(message => message.content)).toEqual([
    'full thinking',
    'full answer',
  ]);
  // Token-frequency deltas must not invalidate the sidebar summary list (issue #141).
  expect(updated.sessions[0]?.updatedAt).toBe(5);
  expect(updated.unreadSessionIds).toBe(unreadBefore);
});
