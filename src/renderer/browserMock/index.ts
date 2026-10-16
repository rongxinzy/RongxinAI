/**
 * Browser preview implementation of `window.electron`.
 *
 * Only the IPC calls needed to render the main screens are backed by fixtures; each one is
 * typed against the real preload contract. Any other call resolves to a structured
 * `{ success: false }` result (subscriptions return a no-op unsubscribe) so the renderer
 * takes its normal error path instead of crashing.
 */
import {
  mockAgents,
  mockApiConfig,
  mockCoworkConfig,
  mockMagpieCatalog,
  mockMcpServers,
  mockSession,
  mockSessionSummaries,
  mockScheduledTasks,
  mockSkills,
  mockWorkspaces,
} from './fixtures';

type ElectronApi = Window['electron'];

type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** Typed overrides: every provided entry must match the real preload contract exactly. */
type MockOverrides = DeepPartial<ElectronApi>;

const UNAVAILABLE = { success: false, error: 'Not available in browser preview' } as const;

/**
 * Stand-in for an IPC member without a fixture. It works both as a nested namespace
 * (property access) and as a method: `onX` subscriptions return a no-op unsubscribe,
 * every other call resolves to a structured failure.
 */
function unavailable(name: string): unknown {
  const call = /^on[A-Z]/.test(name) ? () => () => undefined : () => Promise.resolve(UNAVAILABLE);
  return new Proxy(call, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string' || prop === 'then' || Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }
      return unavailable(prop);
    },
  });
}

const wrapped = new WeakMap<object, object>();

function withFallback<T extends object>(implemented: T): T {
  return new Proxy(implemented, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (!Reflect.has(target, prop)) return unavailable(prop);
      const value: unknown = Reflect.get(target, prop, receiver);
      if (value === null || typeof value !== 'object') return value;
      let ns = wrapped.get(value);
      if (!ns) {
        ns = withFallback(value);
        wrapped.set(value, ns);
      }
      return ns;
    },
  });
}

function createBrowserMock(overrides: MockOverrides): ElectronApi {
  // Every member the overrides omit is synthesised by the fallback proxies at runtime.
  return withFallback(overrides) as ElectronApi;
}

const overrides: MockOverrides = {
  platform: 'darwin',
  arch: 'arm64',
  store: {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  },
  appInfo: {
    getVersion: () => Promise.resolve('0.0.0-preview'),
    isDev: () => Promise.resolve(true),
    isEnterprise: () => Promise.resolve(false),
    getSystemLocale: () => Promise.resolve(navigator.language),
    consumePendingLocalInferenceInstall: () => Promise.resolve(null),
  },
  getApiConfig: () => Promise.resolve(mockApiConfig),
  checkApiConfig: () => Promise.resolve({ hasConfig: true, config: mockApiConfig }),
  getRecentCwds: () => Promise.resolve(mockWorkspaces.map(ws => ws.path)),
  window: {
    minimize: () => undefined,
    toggleMaximize: () => undefined,
    close: () => undefined,
    showSystemMenu: () => undefined,
    isMaximized: () => Promise.resolve(false),
  },
  log: {
    fromRenderer: () => undefined,
  },
  networkStatus: {
    send: () => undefined,
  },
  llamacpp: {
    status: () =>
      Promise.resolve({
        status: 'running',
        version: 'preview',
        managedByApp: true,
        checkedAt: new Date().toISOString(),
      }),
    listLocalModels: () => Promise.resolve([]),
    listRunningModels: () => Promise.resolve([]),
    modelsDir: () => Promise.resolve('/home/user/.zhiyuan/models'),
  },
  ollama: {
    listLocalModels: () => Promise.resolve([]),
    listRunningModels: () => Promise.resolve([]),
    modelsDir: () => Promise.resolve('/home/user/.ollama/models'),
  },
  enterprise: {
    getConfig: () => Promise.resolve(null),
    renderer: {
      sessionGateEntrypoint: () => Promise.resolve(null),
      settingsPages: () => Promise.resolve([]),
    },
  },
  activity: {
    list: () => Promise.resolve({ success: true, runs: [] }),
  },
  agents: {
    list: () => Promise.resolve(mockAgents),
    get: id => Promise.resolve(mockAgents.find(agent => agent.id === id) ?? null),
  },
  skills: {
    list: () => Promise.resolve({ success: true, skills: mockSkills }),
  },
  mcp: {
    list: () => Promise.resolve({ success: true, servers: mockMcpServers }),
  },
  workbenchTask: {
    getCurrent: () => Promise.resolve({ success: true }),
    listForSession: () => Promise.resolve({ success: true, tasks: [] }),
  },
  autoLaunch: {
    get: () => Promise.resolve({ enabled: false }),
  },
  preventSleep: {
    get: () => Promise.resolve({ enabled: false }),
  },
  magpie: {
    catalog: () => Promise.resolve(mockMagpieCatalog),
    selectDefault: () => Promise.resolve(mockMagpieCatalog),
    status: () => Promise.resolve(mockMagpieCatalog.status),
    models: () => Promise.resolve(mockMagpieCatalog.models),
  },
  scheduledTasks: {
    list: () => Promise.resolve({ success: true, tasks: mockScheduledTasks }),
  },
  cowork: {
    getConfig: () => Promise.resolve({ success: true, config: mockCoworkConfig }),
    listWorkspaces: () => Promise.resolve({ success: true, workspaces: mockWorkspaces }),
    listSessions: options =>
      Promise.resolve({
        success: true,
        sessions: mockSessionSummaries.filter(
          session => !options?.workspaceId || session.workspaceId === options.workspaceId,
        ),
        hasMore: false,
      }),
    getSession: sessionId => {
      const session = mockSession(sessionId);
      return Promise.resolve(
        session ? { success: true, session } : { success: false, error: 'Session not found' },
      );
    },
    getSessionMessages: ({ sessionId }) => {
      const messages = mockSession(sessionId)?.messages ?? [];
      return Promise.resolve({ success: true, messages, offset: 0, total: messages.length });
    },
    getRunSnapshot: () => Promise.resolve({ success: true, snapshot: null, running: false }),
    getRuntimeSnapshots: () => Promise.resolve([]),
    listPendingMessages: () => Promise.resolve({ success: true, items: [] }),
  },
};

export const browserMockElectron: ElectronApi = createBrowserMock(overrides);
