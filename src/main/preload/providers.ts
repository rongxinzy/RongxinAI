import { ipcRenderer } from 'electron';

import { AgentIpcChannel } from '../../shared/agent/constants';
import { AISphereIpc } from '../../shared/aisphere';
import { EnterpriseRendererIpc } from '../../shared/enterpriseRenderer';
import { EnterpriseSessionIpc } from '../../shared/enterpriseSession';
import {
  CommunityAuthIpc,
  EnterpriseIpc,
  GitHubCopilotIpc,
  ManagedProviderIpc,
  ModelPoolIpc,
  OpenAICodexOAuthIpc,
} from '../../shared/ipc/channels';
import { MagpieIpc, type MagpieModelSelection } from '../../shared/magpie/types';
import { onPush, onPushVoid } from './pushChannel';

// Model providers, agent profiles, enterprise, and OAuth integrations.
export const providersApi = {
  enterprise: {
    getConfig: () => ipcRenderer.invoke(EnterpriseIpc.GetConfig),
    renderer: {
      sessionGateEntrypoint: () =>
        ipcRenderer.invoke(EnterpriseRendererIpc.SessionGateEntrypoint) as Promise<string | null>,
      settingsPages: () =>
        ipcRenderer.invoke(EnterpriseRendererIpc.SettingsPages) as Promise<
          readonly import('../../shared/enterpriseRenderer').EnterpriseRendererSettingsPage[]
        >,
    },
    session: {
      snapshot: () => ipcRenderer.invoke(EnterpriseSessionIpc.Snapshot),
      login: (input: unknown) => ipcRenderer.invoke(EnterpriseSessionIpc.Login, input),
      changePassword: (input: unknown) =>
        ipcRenderer.invoke(EnterpriseSessionIpc.ChangePassword, input),
      logout: () => ipcRenderer.invoke(EnterpriseSessionIpc.Logout),
    },
  },

  managedProviders: {
    policy: () =>
      ipcRenderer.invoke(ManagedProviderIpc.Policy) as Promise<
        import('../../shared/managedProviders').ManagedProviderAccessPolicy
      >,
    catalog: () =>
      ipcRenderer.invoke(ManagedProviderIpc.Catalog) as Promise<
        readonly import('../../shared/managedProviders').ManagedProviderCatalogModel[]
      >,
    onChanged: (callback: () => void) => onPushVoid(ManagedProviderIpc.Changed, callback),
    aisphereSnapshot: () =>
      ipcRenderer.invoke(AISphereIpc.Snapshot) as Promise<
        import('../../shared/aisphere').AISphereSnapshot
      >,
    aisphereConnect: (address: string) =>
      ipcRenderer.invoke(AISphereIpc.Connect, address) as Promise<
        import('../../shared/aisphere').AISphereSnapshot
      >,
    aisphereRefresh: () =>
      ipcRenderer.invoke(AISphereIpc.Refresh) as Promise<
        import('../../shared/aisphere').AISphereSnapshot
      >,
  },

  agents: {
    list: async () => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.List);
      return result?.success ? result.agents : [];
    },
    get: async (id: string) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Get, id);
      return result?.success ? result.agent : null;
    },
    create: async (request: {
      id?: string;
      name: string;
      description?: string;
      systemPrompt?: string;
      identity?: string;
      model?: string;
      workingDirectory?: string;
      icon?: string;
      skillIds?: string[];
      source?: string;
      presetId?: string;
    }) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Create, request);
      return result?.success ? result.agent : null;
    },
    update: async (
      id: string,
      updates: {
        name?: string;
        description?: string;
        systemPrompt?: string;
        identity?: string;
        model?: string;
        workingDirectory?: string;
        icon?: string;
        skillIds?: string[];
        enabled?: boolean;
        pinned?: boolean;
      },
    ) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Update, id, updates);
      return result?.success ? result.agent : null;
    },
    delete: async (id: string) => {
      const result = await ipcRenderer.invoke(AgentIpcChannel.Delete, id);
      return result?.success ? result.deleted : false;
    },
    importExpertPackage: async (expertDir: string) => {
      return await ipcRenderer.invoke(AgentIpcChannel.ImportExpertPackage, expertDir);
    },
    getPresetExperts: async () => {
      return await ipcRenderer.invoke(AgentIpcChannel.GetPresetExperts);
    },
  },

  magpie: {
    status: () => ipcRenderer.invoke(MagpieIpc.status),
    setSubscriptionAccounts: (enabled: boolean) =>
      ipcRenderer.invoke(MagpieIpc.setSubscriptionAccounts, enabled),
    start: () => ipcRenderer.invoke(MagpieIpc.start),
    stop: () => ipcRenderer.invoke(MagpieIpc.stop),
    agents: () => ipcRenderer.invoke(MagpieIpc.agents),
    setModel: (selection: MagpieModelSelection) =>
      ipcRenderer.invoke(MagpieIpc.setModel, selection),
    models: () => ipcRenderer.invoke(MagpieIpc.models),
    catalog: () => ipcRenderer.invoke(MagpieIpc.catalog),
    selectDefault: (modelId: string) => ipcRenderer.invoke(MagpieIpc.selectDefault, modelId),
    openManagement: () => ipcRenderer.invoke(MagpieIpc.openManagement),
  },

  auth: {
    communityLogin: () => ipcRenderer.invoke(CommunityAuthIpc.Login),
    getCommunityUser: () => ipcRenderer.invoke(CommunityAuthIpc.GetCommunityUser),
    communityLogout: () => ipcRenderer.invoke(CommunityAuthIpc.Logout),
    onCommunityCallback: (
      callback: (data: {
        success: boolean;
        user?: { id: string; email: string; name: string };
        error?: string;
      }) => void,
    ) => onPush(CommunityAuthIpc.Callback, callback),
  },

  modelPool: {
    listModels: () => ipcRenderer.invoke(ModelPoolIpc.ListModels),
    stream: (input: { requestId: string; conversationId: string; body: Record<string, unknown> }) =>
      ipcRenderer.invoke(ModelPoolIpc.Stream, input),
    cancelStream: (requestId: string) => ipcRenderer.invoke(ModelPoolIpc.CancelStream, requestId),
    onStreamData: (requestId: string, callback: (data: string) => void) =>
      onPush(ModelPoolIpc.streamData(requestId), callback),
    onStreamDone: (requestId: string, callback: () => void) =>
      onPushVoid(ModelPoolIpc.streamDone(requestId), callback),
    onStreamError: (requestId: string, callback: (error: string) => void) =>
      onPush(ModelPoolIpc.streamError(requestId), callback),
    onStreamAbort: (requestId: string, callback: () => void) =>
      onPushVoid(ModelPoolIpc.streamAbort(requestId), callback),
  },

  githubCopilot: {
    requestDeviceCode: () => ipcRenderer.invoke(GitHubCopilotIpc.RequestDeviceCode),
    pollForToken: (deviceCode: string, interval: number, expiresIn: number) =>
      ipcRenderer.invoke(GitHubCopilotIpc.PollForToken, { deviceCode, interval, expiresIn }),
    cancelPolling: () => ipcRenderer.invoke(GitHubCopilotIpc.CancelPolling),
    signOut: () => ipcRenderer.invoke(GitHubCopilotIpc.SignOut),
    refreshToken: () => ipcRenderer.invoke(GitHubCopilotIpc.RefreshToken),
    onTokenUpdated: (callback: (data: { token: string; baseUrl: string }) => void) =>
      onPush(GitHubCopilotIpc.TokenUpdated, callback),
  },

  openaiCodexOAuth: {
    start: () => ipcRenderer.invoke(OpenAICodexOAuthIpc.Start),
    cancel: () => ipcRenderer.invoke(OpenAICodexOAuthIpc.Cancel),
    logout: () => ipcRenderer.invoke(OpenAICodexOAuthIpc.Logout),
    status: () => ipcRenderer.invoke(OpenAICodexOAuthIpc.Status),
  },
};
