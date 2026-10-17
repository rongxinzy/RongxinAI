/**
 * Ambient preload contract for `window.electron`.
 *
 * The namespace bodies live in focused modules under `./electron/`; this file
 * keeps the ordered member table and augments the global `Window`. Member
 * order is load-bearing: scripts/preview/generate-browser-mock.ts walks the
 * IElectronAPI properties in declaration order to generate the browser
 * preview mock, so keep the list in its current order when moving members.
 */
import type {
  ApiProxyApi,
  AppEventsApi,
  ContextMenuApi,
  MemoryApi,
  StoreApi,
  WindowApi,
} from './electron/appCoreApi';
import type {
  AppInfoApi,
  AppUpdateApi,
  DialogApi,
  LogApi,
  ProjectApi,
  ShellApi,
} from './electron/appSystemApi';
import type { McpApi, SkillsApi } from './electron/skillsMcpApi';
import type {
  HardwareApi,
  LlamaCppApi,
  MarketplaceApi,
  OllamaApi,
  TriageApi,
} from './electron/localInferenceApi';
import type { AgentsApi, TodoApi, WorkbenchTaskApi } from './electron/agentsApi';
import type { CoworkApi } from './electron/coworkApi';
import type { CodingAgentApi } from './electron/codingAgentApi';
import type { ImApi } from './electron/imApi';
import type { ScheduledTasksApi } from './electron/scheduledTaskApi';
import type {
  ActivityApi,
  AuthApi,
  DingTalkApi,
  EnterpriseApi,
  FeishuApi,
  GithubCopilotApi,
  ManagedProvidersApi,
  ModelPoolApi,
  OpenaiCodexOAuthApi,
  PermissionsApi,
} from './electron/integrationsApi';
import type { RuntimeRetryNotice } from '../../common/runtimeNotice';

export interface IElectronAPI {
  platform: string;
  arch: string;
  store: StoreApi;
  skills: SkillsApi;
  mcp: McpApi;
  ollama: OllamaApi;
  llamacpp: LlamaCppApi;
  marketplace: MarketplaceApi;
  triage: TriageApi;
  hardware: HardwareApi;
  agents: AgentsApi;
  api: ApiProxyApi;
  checkApiConfig: (options?: {
    probeModel?: boolean;
  }) => Promise<{ hasConfig: boolean; config: null; error?: string }>;
  generateSessionTitle: (userInput: string | null) => Promise<string>;
  getRecentCwds: (limit?: number) => Promise<string[]>;
  appEvents: AppEventsApi;
  contextMenu: ContextMenuApi;
  window: WindowApi;
  memory: MemoryApi;
  magpie: import('../../shared/magpie/types').MagpieApi;
  cowork: CoworkApi;
  workbenchTask: WorkbenchTaskApi;
  todo: TodoApi;
  codingAgent: CodingAgentApi;
  dialog: DialogApi;
  project: ProjectApi;
  shell: ShellApi;
  autoLaunch: {
    get: () => Promise<{ enabled: boolean }>;
    set: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  };
  preventSleep: {
    get: () => Promise<{ enabled: boolean }>;
    set: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  };
  appInfo: AppInfoApi;
  appUpdate: AppUpdateApi;
  runtimeNotices: {
    onNotice: (callback: (notice: RuntimeRetryNotice) => void) => () => void;
  };
  log: LogApi;
  im: ImApi;
  scheduledTasks: ScheduledTasksApi;
  permissions: PermissionsApi;
  auth: AuthApi;
  modelPool: ModelPoolApi;
  enterprise: EnterpriseApi;
  managedProviders: ManagedProvidersApi;
  networkStatus: {
    send: (status: 'online' | 'offline') => void;
  };
  // 2026/09/17 lixiang  开发态主进程 HTTP 镜像到 DevTools Network
  devNetwork: {
    onEntry: (
      callback: (entry: import('../../shared/devNetworkLog').DevNetworkLogEntry) => void,
    ) => () => void;
  };
  qwen: Record<string, never>;
  feishu: FeishuApi;
  dingtalk: DingTalkApi;
  githubCopilot: GithubCopilotApi;
  openaiCodexOAuth: OpenaiCodexOAuthApi;
  activity: ActivityApi;
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
