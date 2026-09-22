import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import coworkReducer, {
  addSession,
  recoverSession,
  setDraftPrompt,
  setRemoteManaged,
  updateSessionStatus,
} from '../store/slices/coworkSlice';
import skillReducer, { setActiveSkillIds } from '../store/slices/skillSlice';
import {
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../shared/cowork/constants';
import { PiUiEventSequencer, PiUiEventType, type PiUiEvent } from '../../shared/cowork/piUiEvent';
import { PiUiRuntimeSnapshots } from '../../shared/cowork/piUiRuntimeSnapshot';
import type { CoworkSession } from '../types/cowork';
import { coworkService } from './cowork';
import { workspaceService } from './workspace';

vi.mock('../store', () => ({
  store: {
    getState: () => state.getState(),
    dispatch: (action: UnknownAction) => state.dispatch(action),
  },
}));
vi.mock('./workspace', () => ({
  workspaceService: {
    loadWorkspaces: vi.fn(),
    selectWorkspace: vi.fn(),
    isWorkspaceApiAvailable: () => false,
  },
}));
vi.mock('./i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('./coworkSessionRenderPreparation', () => ({ prepareCoworkSessionRender: vi.fn() }));
const makeStore = () =>
  configureStore({
    reducer: {
      cowork: coworkReducer,
      skill: skillReducer,
      workspace: () => ({ currentWorkspaceId: 'workspace-A' }),
      agent: () => ({ currentAgentId: 'agent-A' }),
    },
  });
let state: ReturnType<typeof makeStore>;
let deliver: (event: PiUiEvent) => void;
let sequencer: PiUiEventSequencer;
let snapshots: PiUiRuntimeSnapshots;
const getSession = vi.fn();
const session = (id: string): CoworkSession => ({
  id,
  status: CoworkSessionStatus.Idle,
  title: id,
  claudeSessionId: null,
  mode: CoworkSessionMode.Work,
  pinned: false,
  cwd: '/tmp',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'local',
  activeSkillIds: [],
  workspaceId: `workspace-${id}`,
  agentId: `agent-${id}`,
  source: CoworkSessionSource.Manual,
  messages: [{ id: 'm', type: 'assistant', content: 'persisted', timestamp: 1 }],
  messagesOffset: 0,
  totalMessages: 1,
  createdAt: 1,
  updatedAt: 1,
});
function publish(event: PiUiEvent, dropped = false) {
  snapshots.observe(event);
  if (!dropped) deliver(event);
}
beforeEach(() => {
  state = makeStore();
  sequencer = new PiUiEventSequencer(() => crypto.randomUUID());
  snapshots = new PiUiRuntimeSnapshots();
  getSession
    .mockReset()
    .mockImplementation(async (id: string) => ({ success: true, session: session(id) }));
  vi.stubGlobal('window', {
    electron: {
      cowork: {
        onStreamUiEvent: (listener: typeof deliver) => {
          deliver = listener;
          return () => {};
        },
        onSessionsChanged: () => () => {},
        getSession,
        getRuntimeSnapshots: async (id?: string) => snapshots.read(id),
        getConfig: async () => ({ success: false }),
        listSessions: async () => ({ success: true, sessions: [] }),
      },
    },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  coworkService.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('reattaching after Started restores a quiet live session without navigating', async () => {
  publish(sequencer.next({ type: PiUiEventType.Started, sessionId: 'B' }), true);
  state.dispatch(addSession(session('A')));
  await coworkService.init();
  await vi.waitFor(() => expect(state.getState().cowork.streamingSessions.B).toBeDefined());
  expect(state.getState().cowork.streamingSessionIds).toContain('B');
  expect(state.getState().cowork.currentSessionId).toBe('A');
});

test('lost completion is recovered and background resync preserves all user selection', async () => {
  await coworkService.init();
  state.dispatch(addSession(session('A')));
  state.dispatch(setDraftPrompt({ sessionId: 'A', draft: 'unsent' }));
  state.dispatch(setActiveSkillIds(['selected-skill']));
  state.dispatch(setRemoteManaged(true));
  publish(sequencer.next({ type: PiUiEventType.Started, sessionId: 'B' }));
  publish(
    sequencer.next({ type: PiUiEventType.Completed, sessionId: 'B', claudeSessionId: null }),
    true,
  );
  publish(sequencer.next({ type: PiUiEventType.QueueUpdated, sessionId: 'B', items: [] }));
  await vi.waitFor(() => expect(state.getState().cowork.streamingSessionIds).not.toContain('B'));
  expect(state.getState().cowork.currentSessionId).toBe('A');
  expect(state.getState().cowork.currentSession?.id).toBe('A');
  expect(state.getState().cowork.draftPrompts.A).toBe('unsent');
  expect(state.getState().cowork.remoteManaged).toBe(true);
  expect(state.getState().workspace.currentWorkspaceId).toBe('workspace-A');
  expect(state.getState().agent.currentAgentId).toBe('agent-A');
  expect(state.getState().skill.activeSkillIds).toEqual(['selected-skill']);
  expect(workspaceService.selectWorkspace).not.toHaveBeenCalled();
});

test('lost completion replaces stale live state and content in the current conversation', async () => {
  await coworkService.init();
  state.dispatch(
    addSession({ ...session('A'), messages: [{ ...session('A').messages[0], content: 'stale' }] }),
  );
  publish(sequencer.next({ type: PiUiEventType.Started, sessionId: 'A' }));
  publish(
    sequencer.next({ type: PiUiEventType.Completed, sessionId: 'A', claudeSessionId: null }),
    true,
  );
  publish(sequencer.next({ type: PiUiEventType.QueueUpdated, sessionId: 'A', items: [] }));
  await vi.waitFor(() =>
    expect(state.getState().cowork.currentSession?.status).toBe(CoworkSessionStatus.Completed),
  );
  expect(state.getState().cowork.streamingSessionIds).toEqual([]);
  expect(state.getState().cowork.streamingSessions.A).toBeUndefined();
  expect(state.getState().cowork.currentSession?.messages[0].content).toBe('persisted');
});

test('database running alone does not create live execution', async () => {
  state.dispatch(addSession({ ...session('A'), status: CoworkSessionStatus.Running }));
  await coworkService.init();
  expect(state.getState().cowork.streamingSessionIds).toEqual([]);
});

test('a missing first Started is recovered from the next observed event', async () => {
  await coworkService.init();
  state.dispatch(addSession(session('A')));
  publish(sequencer.next({ type: PiUiEventType.Started, sessionId: 'A' }), true);
  publish(sequencer.next({ type: PiUiEventType.QueueUpdated, sessionId: 'A', items: [] }));
  await vi.waitFor(() => expect(state.getState().cowork.streamingSessionIds).toContain('A'));
  expect(state.getState().cowork.currentSession?.status).toBe(CoworkSessionStatus.Running);
});

test('recovery preserves older history and newer live content when the IPC races a stream', () => {
  const original = session('A');
  const older = { ...original.messages[0], id: 'old', content: 'older page' };
  state.dispatch(
    addSession({
      ...original,
      messages: [older, { ...original.messages[0], content: 'new live text' }],
      totalMessages: 2,
    }),
  );
  state.dispatch(recoverSession({ session: original, preserveLiveContent: true }));
  expect(state.getState().cowork.currentSession?.messages.map(message => message.content)).toEqual([
    'older page',
    'new live text',
  ]);
  state.dispatch(recoverSession({ session: original, preserveLiveContent: false }));
  expect(state.getState().cowork.currentSession?.messages.map(message => message.content)).toEqual([
    'older page',
    'persisted',
  ]);
});

test('reattaching clears previously tracked execution when runtime already completed', async () => {
  state.dispatch(addSession(session('A')));
  state.dispatch(updateSessionStatus({ sessionId: 'A', status: CoworkSessionStatus.Running }));
  publish(
    sequencer.next({ type: PiUiEventType.Completed, sessionId: 'A', claudeSessionId: null }),
    true,
  );
  await coworkService.init();
  await vi.waitFor(() => expect(state.getState().cowork.streamingSessionIds).toEqual([]));
});
