import { CommunityAuthIpc, ManagedProviderIpc } from '../../shared/ipc/channels';
import { MagpieIpc, providersContractChannels } from '../../shared/ipc/providersContract.channels';
import type { magpieContract, providersContract } from '../../shared/ipc/providersContract';
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
    aisphereDisconnect: asApi('aisphereDisconnect'),
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
    delete: asApi('agentsDelete'),
    importExpertPackage: asApi('agentsImportExpertPackage'),
    getPresetExperts: asApi('agentsGetPresetExperts'),
  },

  magpie: {
    ...createIpcInvokers(MagpieIpc),
  } as IpcContractApi<typeof magpieContract>,

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
} satisfies {
  magpie: IpcContractApi<typeof magpieContract>;
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
    delete: ProvidersContractApi['agentsDelete'];
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
      aisphereDisconnect: 'aisphereDisconnect';
      aisphereRefresh: 'aisphereRefresh';
    }
  >;
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
};
