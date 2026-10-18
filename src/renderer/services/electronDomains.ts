/**
 * Consolidated Domain Facades over `window.electron`.
 *
 * **Experimental:** optional typed grouping for IPC access. New code may keep using
 * `window.electron` directly; this module is not a required layer.
 *
 * Provides high-cohesion, typed access to IPC APIs across 5 primary architectural domains:
 * - System: Host environment, OS info, windows, native dialogs, shell, logs.
 * - Inference: Local and remote inference runtimes (llama.cpp, ollama, magpie, model pool, providers).
 * - Agent: Agent engines, Cowork sessions, Skills, MCP, Tasks, Coding workbench.
 * - Workspace: Project management, memory, persistent SQLite KV store.
 * - Integration: External messaging channels (IM, Feishu, DingTalk).
 */
import type { IElectronAPI } from '../types/electron';

interface SystemDomainApi {
  platform: string;
  arch: string;
  hardware: IElectronAPI['hardware'];
  window: IElectronAPI['window'];
  shell: IElectronAPI['shell'];
  dialog: IElectronAPI['dialog'];
  log: IElectronAPI['log'];
  autoLaunch: IElectronAPI['autoLaunch'];
  preventSleep: IElectronAPI['preventSleep'];
  networkStatus: IElectronAPI['networkStatus'];
  appInfo: IElectronAPI['appInfo'];
  appUpdate: IElectronAPI['appUpdate'];
  contextMenu: IElectronAPI['contextMenu'];
  appEvents: IElectronAPI['appEvents'];
  runtimeNotices: IElectronAPI['runtimeNotices'];
}

interface InferenceDomainApi {
  llamacpp: IElectronAPI['llamacpp'];
  ollama: IElectronAPI['ollama'];
  magpie: IElectronAPI['magpie'];
  modelPool: IElectronAPI['modelPool'];
  managedProviders: IElectronAPI['managedProviders'];
  triage: IElectronAPI['triage'];
  marketplace: IElectronAPI['marketplace'];
}

interface AgentDomainApi {
  cowork: IElectronAPI['cowork'];
  agents: IElectronAPI['agents'];
  skills: IElectronAPI['skills'];
  mcp: IElectronAPI['mcp'];
  todo: IElectronAPI['todo'];
  codingAgent: IElectronAPI['codingAgent'];
  workbenchTask: IElectronAPI['workbenchTask'];
}

interface WorkspaceDomainApi {
  project: IElectronAPI['project'];
  memory: IElectronAPI['memory'];
  store: IElectronAPI['store'];
  getRecentCwds: IElectronAPI['getRecentCwds'];
}

interface IntegrationDomainApi {
  im: IElectronAPI['im'];
  scheduledTasks: IElectronAPI['scheduledTasks'];
  auth: IElectronAPI['auth'];
  permissions: IElectronAPI['permissions'];
  feishu: IElectronAPI['feishu'];
  dingtalk: IElectronAPI['dingtalk'];
  activity: IElectronAPI['activity'];
  enterprise: IElectronAPI['enterprise'];
}

export interface ElectronDomains {
  system: SystemDomainApi;
  inference: InferenceDomainApi;
  agent: AgentDomainApi;
  workspace: WorkspaceDomainApi;
  integration: IntegrationDomainApi;
}

function getElectron(): IElectronAPI {
  if (typeof window === 'undefined' || !window.electron) {
    throw new Error('window.electron is not available in current environment');
  }
  return window.electron;
}

export const electronDomains: ElectronDomains = {
  get system(): SystemDomainApi {
    const e = getElectron();
    return {
      platform: e.platform,
      arch: e.arch,
      hardware: e.hardware,
      window: e.window,
      shell: e.shell,
      dialog: e.dialog,
      log: e.log,
      autoLaunch: e.autoLaunch,
      preventSleep: e.preventSleep,
      networkStatus: e.networkStatus,
      appInfo: e.appInfo,
      appUpdate: e.appUpdate,
      contextMenu: e.contextMenu,
      appEvents: e.appEvents,
      runtimeNotices: e.runtimeNotices,
    };
  },
  get inference(): InferenceDomainApi {
    const e = getElectron();
    return {
      llamacpp: e.llamacpp,
      ollama: e.ollama,
      magpie: e.magpie,
      modelPool: e.modelPool,
      managedProviders: e.managedProviders,
      triage: e.triage,
      marketplace: e.marketplace,
    };
  },
  get agent(): AgentDomainApi {
    const e = getElectron();
    return {
      cowork: e.cowork,
      agents: e.agents,
      skills: e.skills,
      mcp: e.mcp,
      todo: e.todo,
      codingAgent: e.codingAgent,
      workbenchTask: e.workbenchTask,
    };
  },
  get workspace(): WorkspaceDomainApi {
    const e = getElectron();
    return {
      project: e.project,
      memory: e.memory,
      store: e.store,
      getRecentCwds: e.getRecentCwds,
    };
  },
  get integration(): IntegrationDomainApi {
    const e = getElectron();
    return {
      im: e.im,
      scheduledTasks: e.scheduledTasks,
      auth: e.auth,
      permissions: e.permissions,
      feishu: e.feishu,
      dingtalk: e.dingtalk,
      activity: e.activity,
      enterprise: e.enterprise,
    };
  },
};
