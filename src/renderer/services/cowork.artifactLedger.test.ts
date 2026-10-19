import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  CoworkArtifactRole,
  CoworkArtifactSource,
  type CoworkPersistedArtifact,
} from '../../shared/cowork/artifacts';
import coworkReducer from '../store/slices/coworkSlice';
import artifactReducer, {
  activateSessionArtifactView,
  selectSessionArtifacts,
} from '../store/slices/artifactSlice';
import { coworkService, dispatchArtifactUpsert } from './cowork';

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
      artifact: artifactReducer,
      workspace: () => ({ currentWorkspaceId: 'workspace-A' }),
      agent: () => ({ currentAgentId: 'agent-A' }),
      skill: () => ({ activeSkillIds: [] }),
    },
  });
let state: ReturnType<typeof makeStore>;

const ledgerRow = (overrides: Partial<CoworkPersistedArtifact> = {}): CoworkPersistedArtifact => ({
  id: 'row-1',
  messageId: 'm-1',
  toolCallId: 'toolu-1',
  runId: null,
  type: 'html',
  title: 'report.html',
  content: '<h1>report</h1>',
  fileName: 'report.html',
  filePath: 'D:/workspace/report.html',
  source: CoworkArtifactSource.Tool,
  role: CoworkArtifactRole.Intermediate,
  declared: false,
  createdAt: 1,
  ...overrides,
});

beforeEach(() => {
  state = makeStore();
});

afterEach(() => {
  coworkService.destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('a live declared deliverable upsert reveals, an intermediate row lands silently', () => {
  state.dispatch(activateSessionArtifactView('session-1'));

  dispatchArtifactUpsert({
    scopeId: 'session-1',
    artifact: ledgerRow({ role: CoworkArtifactRole.Intermediate, declared: false }),
  });
  let artifactState = state.getState().artifact;
  expect(artifactState.isPanelOpen).toBe(false);
  expect(selectSessionArtifacts({ artifact: artifactState } as never, 'session-1')).toHaveLength(1);

  dispatchArtifactUpsert({
    scopeId: 'session-1',
    artifact: ledgerRow({
      id: 'row-2',
      filePath: 'D:/workspace/slides.html',
      role: CoworkArtifactRole.Deliverable,
      declared: true,
    }),
  });
  artifactState = state.getState().artifact;
  expect(artifactState.isPanelOpen).toBe(true);
  expect(artifactState.selectedArtifactId).toBe('row-2');
});

test('repeated ledger upserts for the same row stay idempotent', () => {
  const row = ledgerRow();
  dispatchArtifactUpsert({ scopeId: 'session-1', artifact: row });
  const rows = state.getState().artifact.artifactsBySession['session-1'];
  expect(rows).toHaveLength(1);

  dispatchArtifactUpsert({ scopeId: 'session-1', artifact: ledgerRow() });
  expect(state.getState().artifact.artifactsBySession['session-1']).toBe(rows);
});

test('loading a session folds the ledger rows in without opening the panel', async () => {
  vi.stubGlobal('window', {
    electron: {
      cowork: {
        onStreamUiEvent: () => () => {},
        onSessionsChanged: () => () => {},
        getSession: async () => ({
          success: true,
          session: {
            id: 'session-1',
            title: 'session',
            status: 'idle',
            pinned: false,
            cwd: '/work',
            systemPrompt: '',
            modelOverride: '',
            executionMode: 'auto',
            activeSkillIds: [],
            workspaceId: '',
            agentId: '',
            source: 'manual',
            messages: [],
            messagesOffset: 0,
            totalMessages: 0,
            artifacts: [ledgerRow({ declared: true, role: CoworkArtifactRole.Deliverable })],
            createdAt: 1,
            updatedAt: 1,
          },
        }),
        remoteManaged: async () => ({ remoteManaged: false }),
        getRuntimeSnapshots: async () => ({ snapshots: [] }),
        requestStreamResync: async () => true,
        getConfig: async () => ({ success: false }),
        listSessions: async () => ({ success: true, sessions: [] }),
      },
      artifacts: { onUpsert: () => () => {} },
    },
  });
  await coworkService.init();

  await coworkService.loadSession('session-1');

  expect(state.getState().artifact.artifactsBySession['session-1']).toHaveLength(1);
  // History is not a live delivery: rows join the list, the panel stays closed.
  expect(state.getState().artifact.isPanelOpen).toBe(false);
});
