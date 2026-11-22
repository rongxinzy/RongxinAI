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
import type { HardwareApi, LlamaCppApi, MarketplaceApi } from './electron/localInferenceApi';
import type { AgentsApi, TodoApi, WorkbenchTaskApi } from './electron/agentsApi';
import type { CoworkApi } from './electron/coworkApi';
import type { CodingAgentApi } from './electron/codingAgentApi';
import type { ImApi } from './electron/imApi';
import type { ScheduledTasksApi } from './electron/scheduledTaskApi';
import type {
  ActivityApi,
  AuthApi,
  EnterpriseApi,
  ManagedProvidersApi,
  PermissionsApi,
} from './electron/integrationsApi';
import type { RuntimeRetryNotice } from '../../common/runtimeNotice';
import type {
  AppSystemInvokers,
  appConfigChannels,
  autoLaunchChannels,
  preventSleepChannels,
} from '../../shared/ipc/appSystemContract.channels';

import type { IpcContractApi } from '../../shared/ipc/contract';
import type { magpieContract } from '../../shared/ipc/providersContract';

type AppConfigApi = AppSystemInvokers<typeof appConfigChannels>;

export interface IElectronAPI {
  platform: string;
  arch: string;
  store: StoreApi;
  desktopPet: import('../../shared/desktopPet/types').DesktopPetApi;
  companion: import('../../shared/companion/types').CompanionNavigationApi;
  skills: SkillsApi;
  mcp: McpApi;
  llamacpp: LlamaCppApi;
  marketplace: MarketplaceApi;
  hardware: HardwareApi;
  agents: AgentsApi;
  checkApiConfig: AppConfigApi['checkApiConfig'];
  generateSessionTitle: AppConfigApi['generateSessionTitle'];
  getRecentCwds: AppConfigApi['getRecentCwds'];
  appEvents: AppEventsApi;
  contextMenu: ContextMenuApi;
  window: WindowApi;
  memory: MemoryApi;
  magpie: IpcContractApi<typeof magpieContract>;
  artifacts: ArtifactsApi;
  cowork: CoworkApi;
  workbenchTask: WorkbenchTaskApi;
  todo: TodoApi;
  codingAgent: CodingAgentApi;
  dialog: DialogApi;
  project: ProjectApi;
  shell: ShellApi;
  autoLaunch: AppSystemInvokers<typeof autoLaunchChannels>;
  preventSleep: AppSystemInvokers<typeof preventSleepChannels>;
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
  enterprise: EnterpriseApi;
  managedProviders: ManagedProvidersApi;
  networkStatus: {
    send: (status: 'online' | 'offline') => void;
  };
  activity: ActivityApi;
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}
