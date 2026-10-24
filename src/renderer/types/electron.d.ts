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
  AppEventsApi,
  ContextMenuApi,
  MemoryApi,
  StoreApi,
  WindowApi,
} from './electron/appCoreApi';
import type { ArtifactsApi } from './electron/artifactsApi';
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
  StrataApi,
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
  ManagedProvidersApi,
  ModelPoolApi,
  PermissionsApi,
} from './electron/integrationsApi';
import type { RuntimeRetryNotice } from '../../common/runtimeNotice';
import type { IpcContractApi } from '../../shared/ipc/contract';
import type { appSystemContract } from '../../shared/ipc/appSystemContract';

type AppSystemContractApi = IpcContractApi<typeof appSystemContract>;

export interface IElectronAPI {
  platform: string;
  arch: string;
  store: StoreApi;
  desktopPet: import('../../shared/desktopPet/types').DesktopPetApi;
  skills: SkillsApi;
  mcp: McpApi;
  ollama: OllamaApi;
  llamacpp: LlamaCppApi;
  marketplace: MarketplaceApi;
  hardware: HardwareApi;
  strata: StrataApi;
  agents: AgentsApi;
  checkApiConfig: AppSystemContractApi['checkApiConfig'];
  generateSessionTitle: AppSystemContractApi['generateSessionTitle'];
  getRecentCwds: AppSystemContractApi['getRecentCwds'];
  appEvents: AppEventsApi;
  contextMenu: ContextMenuApi;
  window: WindowApi;
  memory: MemoryApi;
  magpie: import('../../shared/magpie/types').MagpieApi;
  artifacts: ArtifactsApi;
  cowork: CoworkApi;
  workbenchTask: WorkbenchTaskApi;
  todo: TodoApi;
  codingAgent: CodingAgentApi;
  dialog: DialogApi;
  project: ProjectApi;
  shell: ShellApi;
  autoLaunch: {
    get: AppSystemContractApi['autoLaunchGet'];
    set: AppSystemContractApi['autoLaunchSet'];
  };
  preventSleep: {
    get: AppSystemContractApi['preventSleepGet'];
    set: AppSystemContractApi['preventSleepSet'];
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
  feishu: FeishuApi;
  dingtalk: DingTalkApi;
  activity: ActivityApi;
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
