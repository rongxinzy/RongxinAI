/**
 * Integration preload surface, split from `../electron.d.ts`.
 *
 * Covers OS permissions, community auth, enterprise
 * config/session, managed providers (incl. AISphere), and the activity feed.
 *
 * Invoke method signatures derive from the zod IPC contract
 * (`src/shared/ipc/providersContract.ts`).
 */
import type { ActivityRun } from '../../../shared/activity/types';
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { activityContract } from '../../../shared/ipc/automationContract';
import type {
  AppSystemInvokers,
  permissionsChannels,
} from '../../../shared/ipc/appSystemContract.channels';
import type { providersContract } from '../../../shared/ipc/providersContract';

type ProvidersContractApi = IpcContractApi<typeof providersContract>;

/** Maps contract method names onto the preload-facing member names. */
type Renamed<M extends Record<string, keyof ProvidersContractApi>> = {
  [K in keyof M]: ProvidersContractApi[M[K]];
};

export type PermissionsApi = AppSystemInvokers<typeof permissionsChannels>;

export interface AuthApi extends Renamed<{
  communityLogin: 'authCommunityLogin';
  getCommunityUser: 'authGetCommunityUser';
  communityLogout: 'authCommunityLogout';
}> {
  onCommunityCallback: (
    callback: (data: {
      success: boolean;
      user?: { id: string; email: string; name: string };
      error?: string;
    }) => void,
  ) => () => void;
}

export interface EnterpriseApi {
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
}

export interface ManagedProvidersApi extends Renamed<{
  policy: 'managedProviderPolicy';
  catalog: 'managedProviderCatalog';
  aisphereSnapshot: 'aisphereSnapshot';
  aisphereConnect: 'aisphereConnect';
  aisphereDisconnect: 'aisphereDisconnect';
  aisphereRefresh: 'aisphereRefresh';
}> {
  onChanged: (callback: () => void) => () => void;
}

type ActivityContractApi = IpcContractApi<typeof activityContract>;

export interface ActivityApi extends Omit<ActivityContractApi, 'onUpdated'> {
  onUpdated: (callback: (run: ActivityRun) => void) => () => void;
}
