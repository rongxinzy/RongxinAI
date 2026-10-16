/**
 * Fixture-backed behavior layered on the generated IPC surface.
 * These methods are implemented, so they do not emit the "not implemented" warning.
 */
import {
  CoworkExecutionMode,
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../../shared/cowork/constants';
import { CoworkRunPhase } from '../../shared/cowork/runState';
import {
  PiUiEventSequencer,
  PiUiEventType,
  type PiUiEventPayload,
} from '../../shared/cowork/piUiEvent';
import type { LlamaCppModelLaunchLogSession } from '../../shared/llamacpp';
import { LlamaCppModelLaunchLogSessionStatus } from '../../shared/llamacpp';
import {
  mockActivityRuns,
  mockAgents,
  mockApiConfig,
  mockCoworkConfig,
  mockMagpieCatalog,
  mockMcpServers,
  mockScheduledTasks,
  mockSession,
  mockSessionSummaries,
  mockSkills,
  mockWorkspaces,
  type MockMcpServer,
  type MockSession,
} from './fixtures';

type MockSkill = (typeof mockSkills)[number];
import type { BrowserMockRuntime } from './runtime';

type ElectronApi = Window['electron'];
type StartOptions = Parameters<ElectronApi['cowork']['startSession']>[0];
type ContinueOptions = Parameters<ElectronApi['cowork']['continueSession']>[0];
type ListOptions = Parameters<ElectronApi['cowork']['listSessions']>[0];

const PREVIEW_REPLY =
  'Browser preview reply is ready. This answer was streamed by the mock so the conversation can be reviewed without a model.';
const PREVIEW_ROOT = '/home/user/projects/preview';

interface PreviewEntry {
  mode: CoworkSessionMode;
  session: MockSession;
}

function cloneSession(id: string, mode: CoworkSessionMode): PreviewEntry | undefined {
  const session = mockSession(id);
  if (!session) return undefined;
  return {
    mode,
    session: { ...session, mode, messages: session.messages.map(message => ({ ...message })) },
  };
}

function sessionMode(options: object): CoworkSessionMode {
  if ('mode' in options && options.mode === CoworkSessionMode.Chat) return CoworkSessionMode.Chat;
  return CoworkSessionMode.Work;
}

export function createInteractiveOverrides(runtime: BrowserMockRuntime) {
  const store = new Map<string, unknown>();
  const sessions = new Map<string, PreviewEntry>();
  for (const summary of mockSessionSummaries) {
    const entry = cloneSession(summary.id, CoworkSessionMode.Work);
    if (entry) sessions.set(summary.id, entry);
  }
  const chatNow = Date.UTC(2026, 9, 16, 6, 0, 0);
  sessions.set('session-chat-1', {
    mode: CoworkSessionMode.Chat,
    session: {
      id: 'session-chat-1',
      title: 'Draft a weekly update',
      status: CoworkSessionStatus.Completed,
      pinned: false,
      cwd: mockWorkspaces[0]?.path ?? PREVIEW_ROOT,
      systemPrompt: '',
      modelOverride: '',
      executionMode: CoworkExecutionMode.Auto,
      activeSkillIds: [],
      workspaceId: '',
      agentId: 'main',
      source: CoworkSessionSource.Manual,
      mode: CoworkSessionMode.Chat,
      messages: [
        {
          id: 'msg-chat-1',
          type: 'user',
          content: 'Draft a short weekly update for the calculator project.',
          timestamp: chatNow,
        },
        {
          id: 'msg-chat-2',
          type: 'assistant',
          content: 'This week the calculator gained keyboard input and a division-by-zero test.',
          timestamp: chatNow + 1000,
        },
      ],
      messagesOffset: 0,
      totalMessages: 2,
      createdAt: chatNow,
      updatedAt: chatNow + 1000,
    },
  });

  let liveCount = 0;
  let eventCount = 0;
  const sequencer = new PiUiEventSequencer(() => {
    eventCount += 1;
    return `preview-event-${eventCount}`;
  });
  let skills: MockSkill[] = mockSkills.map(skill => ({ ...skill }));
  let servers: MockMcpServer[] = mockMcpServers.map(server => ({ ...server }));
  const tasks = mockScheduledTasks.map(task => ({ ...task }));

  const emitUi = (payload: PiUiEventPayload) => {
    runtime.emit('cowork.onStreamUiEvent', sequencer.next(payload));
  };

  const streamAssistant = (sessionId: string, user?: { id: string; content: string }) => {
    setTimeout(() => {
      if (user) {
        emitUi({
          type: PiUiEventType.Message,
          sessionId,
          message: { id: user.id, type: 'user', content: user.content, timestamp: Date.now() },
        });
      }
      emitUi({ type: PiUiEventType.Started, sessionId });
      const assistantId = `msg-assistant-${Date.now()}`;
      const assistant = {
        id: assistantId,
        type: 'assistant' as const,
        content: '',
        timestamp: Date.now(),
      };
      const entry = sessions.get(sessionId);
      if (entry) {
        entry.session = {
          ...entry.session,
          messages: [...entry.session.messages, assistant],
          totalMessages: entry.session.messages.length + 1,
          status: CoworkSessionStatus.Running,
        };
      }
      // Emit a copy. Redux freezes the object it stores, so the fixture must not mutate it later.
      emitUi({ type: PiUiEventType.Message, sessionId, message: { ...assistant } });
      const chunks = [
        PREVIEW_REPLY.slice(0, 28),
        PREVIEW_REPLY.slice(28, 70),
        PREVIEW_REPLY.slice(70),
      ];
      let accumulated = '';
      chunks.forEach((chunk, index) => {
        setTimeout(
          () => {
            accumulated += chunk;
            emitUi({
              type: PiUiEventType.MessageUpdate,
              sessionId,
              messageId: assistantId,
              content: accumulated,
            });
            if (index !== chunks.length - 1) return;
            const current = sessions.get(sessionId);
            if (current) {
              current.session = {
                ...current.session,
                messages: current.session.messages.map(item =>
                  item.id === assistantId ? { ...item, content: accumulated } : item,
                ),
                status: CoworkSessionStatus.Completed,
                updatedAt: Date.now(),
              };
            }
            emitUi({ type: PiUiEventType.Completed, sessionId });
          },
          70 * (index + 1),
        );
      });
    }, 30);
  };

  const summaryOf = (session: MockSession) => ({
    id: session.id,
    title: session.title,
    status: session.status,
    pinned: session.pinned,
    ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
    agentId: session.agentId,
    source: session.source,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });

  const logSession: LlamaCppModelLaunchLogSession = {
    sessionId: 'preview-log',
    modelName: 'preview-model',
    fileName: 'preview.log',
    filePath: '/home/user/.zhiyuan/logs/preview.log',
    startedAt: '2026-10-16T07:00:00.000Z',
    updatedAt: '2026-10-16T07:00:01.000Z',
    status: LlamaCppModelLaunchLogSessionStatus.Succeeded,
    sequence: 1,
  };

  return {
    store: {
      get: (key: string) => Promise.resolve(store.has(key) ? store.get(key) : null),
      set: (key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      },
      remove: (key: string) => {
        store.delete(key);
        return Promise.resolve();
      },
    },
    appInfo: {
      getVersion: () => Promise.resolve('0.0.0-preview'),
      isDev: () => Promise.resolve(true),
      isEnterprise: () => Promise.resolve(false),
      getSystemLocale: () =>
        Promise.resolve(typeof navigator === 'undefined' ? 'en-US' : navigator.language),
      consumePendingLocalInferenceInstall: () => Promise.resolve(null),
    },
    getApiConfig: () => Promise.resolve(mockApiConfig),
    checkApiConfig: () => Promise.resolve({ hasConfig: true, config: mockApiConfig }),
    getRecentCwds: () => Promise.resolve(mockWorkspaces.map(workspace => workspace.path)),
    window: {
      minimize: () => undefined,
      toggleMaximize: () => undefined,
      close: () => undefined,
      showSystemMenu: () => undefined,
      isMaximized: () => Promise.resolve(false),
    },
    log: { fromRenderer: () => undefined },
    networkStatus: { send: () => undefined },
    autoLaunch: { get: () => Promise.resolve({ enabled: false }) },
    preventSleep: { get: () => Promise.resolve({ enabled: false }) },
    enterprise: {
      getConfig: () => Promise.resolve(null),
      renderer: {
        sessionGateEntrypoint: () => Promise.resolve(null),
        settingsPages: () => Promise.resolve([]),
      },
    },
    activity: { list: () => Promise.resolve({ success: true, runs: mockActivityRuns }) },
    agents: {
      list: () => Promise.resolve(mockAgents),
      get: (id: string) => Promise.resolve(mockAgents.find(agent => agent.id === id) ?? null),
    },
    magpie: {
      catalog: () => Promise.resolve(mockMagpieCatalog),
      selectDefault: () => Promise.resolve(mockMagpieCatalog),
      status: () => Promise.resolve(mockMagpieCatalog.status),
      models: () => Promise.resolve(mockMagpieCatalog.models),
    },
    llamacpp: {
      status: () =>
        Promise.resolve({
          status: 'running' as const,
          version: 'preview',
          managedByApp: true,
          checkedAt: '2026-10-16T07:00:00.000Z',
        }),
      listLocalModels: () => Promise.resolve([]),
      listRunningModels: () => Promise.resolve([]),
      modelsDir: () => Promise.resolve('/home/user/.zhiyuan/models'),
      readModelLaunchLogFile: () =>
        Promise.resolve({
          success: true,
          session: logSession,
          content: 'preview model server listening\n',
          startOffset: 0,
          nextOffset: 32,
        }),
    },
    ollama: {
      listLocalModels: () => Promise.resolve([]),
      listRunningModels: () => Promise.resolve([]),
      modelsDir: () => Promise.resolve('/home/user/.ollama/models'),
    },
    skills: {
      list: () => Promise.resolve({ success: true, skills }),
      setEnabled: ({ id, enabled }: { id: string; enabled: boolean }) => {
        skills = skills.map(skill => (skill.id === id ? { ...skill, enabled } : skill));
        return Promise.resolve({ success: true, skills });
      },
      setEnabledBatch: ({ ids, enabled }: { ids: string[]; enabled: boolean }) => {
        const selected = new Set(ids);
        skills = skills.map(skill => (selected.has(skill.id) ? { ...skill, enabled } : skill));
        return Promise.resolve({ success: true, skills });
      },
      setPinned: ({ id, pinned }: { id: string; pinned: boolean }) => {
        skills = skills.map(skill => (skill.id === id ? { ...skill, pinned } : skill));
        return Promise.resolve({ success: true, skills });
      },
      delete: (id: string) => {
        skills = skills.filter(skill => skill.id !== id);
        return Promise.resolve({ success: true, skills });
      },
      download: () => Promise.resolve({ success: true, skills }),
      getContent: (skillId: string) =>
        Promise.resolve({
          success: true,
          content: `# ${skills.find(skill => skill.id === skillId)?.name ?? skillId}\n\nPreview skill instructions.`,
        }),
    },
    mcp: {
      list: () => Promise.resolve({ success: true, servers }),
      setEnabled: ({ id, enabled }: { id: string; enabled: boolean }) => {
        servers = servers.map(server => (server.id === id ? { ...server, enabled } : server));
        return Promise.resolve({ success: true, servers });
      },
      delete: (id: string) => {
        servers = servers.filter(server => server.id !== id);
        return Promise.resolve({ success: true, servers });
      },
      testConnection: () => Promise.resolve({ success: true, toolCount: 2 }),
    },
    scheduledTasks: {
      list: () => Promise.resolve({ success: true, tasks }),
    },
    dialog: {
      selectDirectory: () => Promise.resolve({ success: true, path: PREVIEW_ROOT }),
      selectFile: () => Promise.resolve({ success: true, path: `${PREVIEW_ROOT}/notes.md` }),
      selectFiles: () => Promise.resolve({ success: true, paths: [`${PREVIEW_ROOT}/notes.md`] }),
      showMessageBox: () => Promise.resolve({ response: 0 }),
    },
    project: {
      getDefaultBaseDir: () => Promise.resolve({ success: true, path: '/home/user/projects' }),
      createDirectory: ({ name }: { name: string }) =>
        Promise.resolve({ success: true, path: `/home/user/projects/${name}` }),
    },
    cowork: {
      getConfig: () => Promise.resolve({ success: true, config: mockCoworkConfig }),
      updateConfig: () => Promise.resolve({ success: true }),
      listWorkspaces: () => Promise.resolve({ success: true, workspaces: mockWorkspaces }),
      listSessions: (options?: ListOptions) => {
        const matched = [...sessions.values()].filter(entry => {
          if (options?.mode && entry.mode !== options.mode) return false;
          if (options?.workspaceId && entry.session.workspaceId !== options.workspaceId)
            return false;
          if (options?.agentId && entry.session.agentId !== options.agentId) return false;
          if (options?.sources && !options.sources.includes(entry.session.source)) return false;
          return true;
        });
        const offset = options?.offset ?? 0;
        const limit = options?.limit ?? matched.length;
        const page = matched.slice(offset, offset + limit);
        return Promise.resolve({
          success: true,
          sessions: page.map(entry => summaryOf(entry.session)),
          hasMore: offset + limit < matched.length,
        });
      },
      getSession: (sessionId: string) => {
        const entry = sessions.get(sessionId);
        return Promise.resolve(
          entry
            ? { success: true, session: entry.session }
            : { success: false, error: 'Session not found' },
        );
      },
      getSessionMessages: ({ sessionId }: { sessionId: string }) => {
        const messages = sessions.get(sessionId)?.session.messages ?? [];
        return Promise.resolve({ success: true, messages, offset: 0, total: messages.length });
      },
      getRunSnapshot: (sessionId: string) => {
        const entry = sessions.get(sessionId);
        const running = entry?.session.status === CoworkSessionStatus.Running;
        const now = Date.now();
        return Promise.resolve({
          success: true,
          running,
          snapshot:
            running && entry
              ? {
                  sessionId,
                  runId: `run-${sessionId}`,
                  sequence: 1,
                  phase: CoworkRunPhase.Writing,
                  running: true,
                  startedAt: entry.session.updatedAt,
                  confirmedAt: entry.session.updatedAt,
                  lastProgressAt: now,
                }
              : null,
        });
      },
      getRuntimeSnapshots: () => Promise.resolve([]),
      listPendingMessages: () => Promise.resolve({ success: true, items: [] }),
      startSession: (options: StartOptions) => {
        liveCount += 1;
        const now = Date.now();
        const id = `session-live-${liveCount}`;
        const mode = sessionMode(options);
        const user = {
          id: `msg-user-${now}`,
          type: 'user' as const,
          content: options.prompt,
          timestamp: now,
        };
        const session: MockSession = {
          id,
          title: options.title?.trim() || options.prompt.slice(0, 80) || 'Preview',
          status: CoworkSessionStatus.Running,
          pinned: false,
          cwd: options.cwd || PREVIEW_ROOT,
          systemPrompt: options.systemPrompt ?? '',
          modelOverride: '',
          executionMode: CoworkExecutionMode.Auto,
          activeSkillIds: options.activeSkillIds ?? [],
          workspaceId: options.workspaceId ?? '',
          agentId: options.agentId ?? 'main',
          source: CoworkSessionSource.Manual,
          mode,
          messages: [user],
          messagesOffset: 0,
          totalMessages: 1,
          createdAt: now,
          updatedAt: now,
        };
        sessions.set(id, { mode, session });
        streamAssistant(id);
        return Promise.resolve({ success: true, session });
      },
      continueSession: (options: ContinueOptions) => {
        const entry = sessions.get(options.sessionId);
        if (!entry) return Promise.resolve({ success: false, error: 'Session not found' });
        const now = Date.now();
        const user = { id: `msg-user-${now}`, content: options.prompt };
        const session = {
          ...entry.session,
          messages: [...entry.session.messages, { ...user, type: 'user' as const, timestamp: now }],
          status: CoworkSessionStatus.Running,
          updatedAt: now,
        };
        session.totalMessages = session.messages.length;
        entry.session = session;
        streamAssistant(options.sessionId, user);
        return Promise.resolve({ success: true, session });
      },
      stopSession: (sessionId: string) => {
        const entry = sessions.get(sessionId);
        if (entry) entry.session.status = CoworkSessionStatus.Idle;
        emitUi({ type: PiUiEventType.Stopped, sessionId });
        return Promise.resolve({ success: true });
      },
    },
  };
}
