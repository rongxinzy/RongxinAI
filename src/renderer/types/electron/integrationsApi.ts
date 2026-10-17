/**
 * Integration preload surface, split from `../electron.d.ts`.
 *
 * Covers OS permissions, community auth, the managed model pool, enterprise
 * config/session, managed providers (incl. AISphere), provider install flows
 * (Feishu, DingTalk, GitHub Copilot, OpenAI Codex OAuth) and the activity feed.
 */
import type { ActivityRun } from '../../../shared/activity/types';
import type {
  EnterprisePasswordChangeInput,
  EnterprisePasswordLoginInput,
  EnterpriseSessionResult,
} from '../../../shared/enterpriseSession';

export interface PermissionsApi {
  checkCalendar: () => Promise<{
    success: boolean;
    status?: string;
    error?: string;
    autoRequested?: boolean;
  }>;
  requestCalendar: () => Promise<{
    success: boolean;
    granted?: boolean;
    status?: string;
    error?: string;
  }>;
}

export interface AuthApi {
  communityLogin: () => Promise<{ success: boolean; error?: string }>;
  getCommunityUser: () => Promise<{ success: boolean; user?: { id: string; email: string } }>;
  communityLogout: () => Promise<{ success: boolean }>;
  onCommunityCallback: (
    callback: (data: {
      success: boolean;
      user?: { id: string; email: string; name: string };
      error?: string;
    }) => void,
  ) => () => void;
}

export interface ModelPoolApi {
  listModels: () => Promise<{
    ok: boolean;
    status: number;
    models: string[];
    error?: string;
  }>;
  stream: (input: {
    requestId: string;
    conversationId: string;
    body: Record<string, unknown>;
  }) => Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    error?: string;
  }>;
  cancelStream: (requestId: string) => Promise<boolean>;
  onStreamData: (requestId: string, callback: (data: string) => void) => () => void;
  onStreamDone: (requestId: string, callback: () => void) => () => void;
  onStreamError: (requestId: string, callback: (error: string) => void) => () => void;
  onStreamAbort: (requestId: string, callback: () => void) => () => void;
}

export interface EnterpriseApi {
  getConfig: () => Promise<{
    ui?: Record<string, 'hide' | 'disable' | 'readonly'>;
    disableUpdate?: boolean;
    version: string;
    name: string;
  } | null>;
  renderer: {
    sessionGateEntrypoint: () => Promise<string | null>;
    settingsPages: () => Promise<
      readonly import('../../../shared/enterpriseRenderer').EnterpriseRendererSettingsPage[]
    >;
  };
  session: {
    snapshot: () => Promise<EnterpriseSessionResult>;
    login: (input: EnterprisePasswordLoginInput) => Promise<EnterpriseSessionResult>;
    changePassword: (input: EnterprisePasswordChangeInput) => Promise<EnterpriseSessionResult>;
    logout: () => Promise<EnterpriseSessionResult>;
  };
}

export interface ManagedProvidersApi {
  policy: () => Promise<import('../../../shared/managedProviders').ManagedProviderAccessPolicy>;
  catalog: () => Promise<
    readonly import('../../../shared/managedProviders').ManagedProviderCatalogModel[]
  >;
  onChanged: (callback: () => void) => () => void;
  aisphereSnapshot: () => Promise<import('../../../shared/aisphere').AISphereSnapshot>;
  aisphereConnect: (
    address: string,
  ) => Promise<import('../../../shared/aisphere').AISphereSnapshot>;
  aisphereRefresh: () => Promise<import('../../../shared/aisphere').AISphereSnapshot>;
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

export interface GithubCopilotApi {
  requestDeviceCode: () => Promise<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
    expiresIn: number;
  }>;
  pollForToken: (
    deviceCode: string,
    interval: number,
    expiresIn: number,
  ) => Promise<{
    success: boolean;
    token?: string;
    githubUser?: string;
    baseUrl?: string;
    error?: string;
  }>;
  cancelPolling: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshToken: () => Promise<{
    success: boolean;
    token?: string;
    baseUrl?: string;
    error?: string;
  }>;
  onTokenUpdated: (callback: (data: { token: string; baseUrl: string }) => void) => () => void;
}

export interface OpenaiCodexOAuthApi {
  start: () => Promise<
    | { success: true; email: string | null; accountId: string | null; expiresAt: number }
    | { success: false; error: string }
  >;
  cancel: () => Promise<void>;
  logout: () => Promise<void>;
  status: () => Promise<
    | { loggedIn: true; email: string | null; accountId: string | null; expiresAt: number }
    | { loggedIn: false }
  >;
}

export interface ActivityApi {
  list: () => Promise<{ success: boolean; runs: ActivityRun[] }>;
  onUpdated: (callback: (run: ActivityRun) => void) => () => void;
}
