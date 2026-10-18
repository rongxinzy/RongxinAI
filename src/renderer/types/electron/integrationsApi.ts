/**
 * Integration preload surface, split from `../electron.d.ts`.
 *
 * Covers OS permissions, community auth, the managed model pool, enterprise
 * config/session, managed providers (incl. AISphere), provider install flows
 * (Feishu, DingTalk) and the activity feed.
 *
 * Invoke method signatures derive from the zod IPC contract
 * (`src/shared/ipc/providersContract.ts`); push subscriptions and the
 * Feishu/DingTalk install flows (owned by the IM domain) stay hand-written.
 */
import type { ActivityRun } from '../../../shared/activity/types';
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { activityContract } from '../../../shared/ipc/automationContract';
import type { appSystemContract } from '../../../shared/ipc/appSystemContract';
import type { providersContract } from '../../../shared/ipc/providersContract';

type AppSystemContractApi = IpcContractApi<typeof appSystemContract>;
type ProvidersContractApi = IpcContractApi<typeof providersContract>;

/** Maps contract method names onto the preload-facing member names. */
type Renamed<M extends Record<string, keyof ProvidersContractApi>> = {
  [K in keyof M]: ProvidersContractApi[M[K]];
};

export interface PermissionsApi {
  checkCalendar: AppSystemContractApi['permissionsCheckCalendar'];
  requestCalendar: AppSystemContractApi['permissionsRequestCalendar'];
}

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

export interface ModelPoolApi extends Renamed<{
  listModels: 'modelPoolListModels';
  stream: 'modelPoolStream';
  cancelStream: 'modelPoolCancelStream';
}> {
  onStreamData: (requestId: string, callback: (data: string) => void) => () => void;
  onStreamDone: (requestId: string, callback: () => void) => () => void;
  onStreamError: (requestId: string, callback: (error: string) => void) => () => void;
  onStreamAbort: (requestId: string, callback: () => void) => () => void;
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
  aisphereRefresh: 'aisphereRefresh';
}> {
  onChanged: (callback: () => void) => () => void;
}

export interface FeishuApi {
  install: {
    verify: (
      appId: string,
      appSecret: string,
    ) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };
}

export interface DingTalkApi {
  install: {
    qrcode: () => Promise<{
      url: string;
      deviceCode: string;
      interval: number;
      expireIn: number;
    }>;
    poll: (deviceCode: string) => Promise<{
      done: boolean;
      clientId?: string;
      clientSecret?: string;
      error?: string;
    }>;
    verify: (
      clientId: string,
      clientSecret: string,
    ) => Promise<{
      success: boolean;
      error?: string;
    }>;
  };
}

type ActivityContractApi = IpcContractApi<typeof activityContract>;

export interface ActivityApi extends Omit<ActivityContractApi, 'onUpdated'> {
  onUpdated: (callback: (run: ActivityRun) => void) => () => void;
}
