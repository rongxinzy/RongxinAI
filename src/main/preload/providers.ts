import { ipcRenderer } from 'electron';

import { CommunityAuthIpc, ManagedProviderIpc, ModelPoolIpc } from '../../shared/ipc/channels';
import { providersContractChannels } from '../../shared/ipc/providersContract.channels';
import type { providersContract } from '../../shared/ipc/providersContract';
import type { IpcContractApi } from '../../shared/ipc/contract';
import { onPush, onPushVoid } from './pushChannel';
import { createIpcInvokers } from './createIpcInvokers';

type ProvidersContractApi = IpcContractApi<typeof providersContract>;
const invokers = createIpcInvokers(providersContractChannels);

// Rename a contract invoker to its preload-facing method name, keeping the
// contract-derived signature.
const asApi = <K extends keyof ProvidersContractApi>(method: K): ProvidersContractApi[K] =>
  invokers[method] as ProvidersContractApi[K];

/** Maps contract method names onto the preload-facing member names. */
type Renamed<M extends Record<string, keyof ProvidersContractApi>> = {
  [K in keyof M]: ProvidersContractApi[M[K]];
};

/** Contract invokers renamed to preload names, plus hand-wired members. */
type WithExtra<E, M extends Record<string, keyof ProvidersContractApi>> = Renamed<M> & E;

// Model providers, agent profiles, enterprise, and OAuth integrations.
// Invoke methods come from the contract channel map via createIpcInvokers;
// push subscriptions (onChanged / onCommunityCallback / onStream*) stay
// hand-wired below.
export const providersApi = {
  enterprise: {
    getConfig: asApi('enterpriseGetConfig'),
    renderer: {
      sessionGateEntrypoint: asApi('enterpriseSessionGateEntrypoint'),
      settingsPages: asApi('enterpriseSettingsPages'),
    },
    session: {
      snapshot: asApi('enterpriseSessionSnapshot'),
      login: asApi('enterpriseSessionLogin'),
      changePassword: asApi('enterpriseSessionChangePassword'),
      logout: asApi('enterpriseSessionLogout'),
    },
  },

  managedProviders: {
    policy: asApi('managedProviderPolicy'),
    catalog: asApi('managedProviderCatalog'),
    onChanged: (callback: () => void) => onPushVoid(ManagedProviderIpc.Changed, callback),
    aisphereSnapshot: asApi('aisphereSnapshot'),
    aisphereConnect: asApi('aisphereConnect'),
    aisphereRefresh: asApi('aisphereRefresh'),
  },

  agents: {
    list: async () => {
      const result = await asApi('agentsList')();
      return result?.success ? result.agents : [];
    },
    get: async (id: string) => {
      const result = await asApi('agentsGet')(id);
      return result?.success ? result.agent : null;
    },
    create: async (
      request: Parameters<ProvidersContractApi['agentsCreate']>[0],
    ): Promise<Awaited<ReturnType<ProvidersContractApi['agentsCreate']>>['agent'] | null> => {
      const result = await asApi('agentsCreate')(request);
      return result?.success ? result.agent : null;
    },
    update: async (
      id: string,
      updates: Parameters<ProvidersContractApi['agentsUpdate']>[1],
    ): Promise<Awaited<ReturnType<ProvidersContractApi['agentsUpdate']>>['agent'] | null> => {
      const result = await asApi('agentsUpdate')(id, updates);
      return result?.success ? result.agent : null;
    },
    delete: async (id: string) => {
      const result = await asApi('agentsDelete')(id);
      return result?.success ? result.deleted : false;
    },
    importExpertPackage: asApi('agentsImportExpertPackage'),
    getPresetExperts: asApi('agentsGetPresetExperts'),
  },

  magpie: {
    status: asApi('magpieStatus'),
    setSubscriptionAccounts: asApi('magpieSetSubscriptionAccounts'),
    start: asApi('magpieStart'),
    stop: asApi('magpieStop'),
    agents: asApi('magpieAgents'),
    setModel: asApi('magpieSetModel'),
    previewAgent: asApi('magpiePreviewAgent'),
    connectAgent: asApi('magpieConnectAgent'),
    disconnectAgent: asApi('magpieDisconnectAgent'),
    disconnectAllAgents: asApi('magpieDisconnectAllAgents'),
    models: asApi('magpieModels'),
    catalog: asApi('magpieCatalog'),
    selectDefault: asApi('magpieSelectDefault'),
    providers: asApi('magpieProviders'),
    saveProvider: asApi('magpieSaveProvider'),
    setProviderEnabled: asApi('magpieSetProviderEnabled'),
    deleteProvider: asApi('magpieDeleteProvider'),
    testProvider: asApi('magpieTestProvider'),
    diagnostics: asApi('magpieDiagnostics'),
    preferences: asApi('magpiePreferences'),
    updatePreferences: asApi('magpieUpdatePreferences'),
  },

  auth: {
    communityLogin: asApi('authCommunityLogin'),
    getCommunityUser: asApi('authGetCommunityUser'),
    communityLogout: asApi('authCommunityLogout'),
    onCommunityCallback: (
      callback: (data: {
        success: boolean;
        user?: { id: string; email: string; name: string };
        error?: string;
      }) => void,
    ) => onPush(CommunityAuthIpc.Callback, callback),
  },

  modelPool: {
    listModels: asApi('modelPoolListModels'),
    stream: asApi('modelPoolStream'),
    cancelStream: asApi('modelPoolCancelStream'),
    onStreamData: (requestId: string, callback: (data: string) => void) =>
      onPush(ModelPoolIpc.streamData(requestId), callback),
    onStreamDone: (requestId: string, callback: () => void) =>
      onPushVoid(ModelPoolIpc.streamDone(requestId), callback),
    onStreamError: (requestId: string, callback: (error: string) => void) =>
      onPush(ModelPoolIpc.streamError(requestId), callback),
    onStreamAbort: (requestId: string, callback: () => void) =>
      onPushVoid(ModelPoolIpc.streamAbort(requestId), callback),
  },
} satisfies {
  agents: {
    list: () => Promise<
      NonNullable<Awaited<ReturnType<ProvidersContractApi['agentsList']>>['agents']>
    >;
    get: (
      id: string,
    ) => Promise<NonNullable<
      Awaited<ReturnType<ProvidersContractApi['agentsGet']>>['agent']
    > | null>;
    create: ProvidersContractApi['agentsCreate'] extends (request: infer R) => Promise<infer Res>
      ? (
          request: R,
        ) => Promise<Res extends { agent?: infer A } ? (A extends null ? never : A | null) : never>
      : never;
    update: ProvidersContractApi['agentsUpdate'] extends (
      id: string,
      updates: infer U,
    ) => Promise<infer Res>
      ? (
          id: string,
          updates: U,
        ) => Promise<Res extends { agent?: infer A } ? (A extends null ? never : A | null) : never>
      : never;
    delete: (id: string) => Promise<boolean>;
    importExpertPackage: ProvidersContractApi['agentsImportExpertPackage'];
    getPresetExperts: ProvidersContractApi['agentsGetPresetExperts'];
  };
  enterprise: {
    getConfig: ProvidersContractApi['enterpriseGetConfig'];
    renderer: Renamed<{
      sessionGateEntrypoint: 'enterpriseSessionGateEntrypoint';
      settingsPages: 'enterpriseSettingsPages';
    }>;
    session: Renamed<{
      snapshot: 'enterpriseSessionSnapshot';
      login: 'enterpriseSessionLogin';
      changePassword: 'enterpriseSessionChangePassword';
      logout: 'enterpriseSessionLogout';
    }>;
  };
  managedProviders: WithExtra<
    { onChanged: (callback: () => void) => () => void },
    {
      policy: 'managedProviderPolicy';
      catalog: 'managedProviderCatalog';
      aisphereSnapshot: 'aisphereSnapshot';
      aisphereConnect: 'aisphereConnect';
      aisphereRefresh: 'aisphereRefresh';
    }
  >;
  magpie: Renamed<{
    status: 'magpieStatus';
    setSubscriptionAccounts: 'magpieSetSubscriptionAccounts';
    start: 'magpieStart';
    stop: 'magpieStop';
    agents: 'magpieAgents';
    setModel: 'magpieSetModel';
    previewAgent: 'magpiePreviewAgent';
    connectAgent: 'magpieConnectAgent';
    disconnectAgent: 'magpieDisconnectAgent';
    disconnectAllAgents: 'magpieDisconnectAllAgents';
    models: 'magpieModels';
    catalog: 'magpieCatalog';
    selectDefault: 'magpieSelectDefault';
    providers: 'magpieProviders';
    saveProvider: 'magpieSaveProvider';
    setProviderEnabled: 'magpieSetProviderEnabled';
    deleteProvider: 'magpieDeleteProvider';
    testProvider: 'magpieTestProvider';
    diagnostics: 'magpieDiagnostics';
    preferences: 'magpiePreferences';
    updatePreferences: 'magpieUpdatePreferences';
  }>;
  auth: WithExtra<
    {
      onCommunityCallback: (
        callback: (data: {
          success: boolean;
          user?: { id: string; email: string; name: string };
          error?: string;
        }) => void,
      ) => () => void;
    },
    {
      communityLogin: 'authCommunityLogin';
      getCommunityUser: 'authGetCommunityUser';
      communityLogout: 'authCommunityLogout';
    }
  >;
  modelPool: WithExtra<
    {
      onStreamData: (requestId: string, callback: (data: string) => void) => () => void;
      onStreamDone: (requestId: string, callback: () => void) => () => void;
      onStreamError: (requestId: string, callback: (error: string) => void) => () => void;
      onStreamAbort: (requestId: string, callback: () => void) => () => void;
    },
    {
      listModels: 'modelPoolListModels';
      stream: 'modelPoolStream';
      cancelStream: 'modelPoolCancelStream';
    }
  >;
};
