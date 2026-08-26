import type {
  EnterprisePasswordChangeInput,
  EnterprisePasswordLoginInput,
  EnterpriseSessionResult,
} from './enterpriseSession';
import type { ManagedProviderCatalogModel } from './managedProviders';

export const EnterpriseRendererIpc = {
  SessionGateEntrypoint: 'enterprise:renderer:session-gate-entrypoint',
  SettingsPages: 'enterprise:renderer:settings-pages',
} as const;

export interface EnterpriseRendererSettingsPage {
  readonly id: string;
  readonly entrypoint: string;
  readonly labels: {
    readonly zh: string;
    readonly en: string;
  };
}

export const EnterpriseRendererSurface = {
  SessionGate: 'session-gate',
  Settings: 'settings',
} as const;

export type EnterpriseRendererSurface =
  (typeof EnterpriseRendererSurface)[keyof typeof EnterpriseRendererSurface];

export const EnterpriseRendererMessageSource = {
  Host: 'zhiyuan.enterprise.host',
  Module: 'zhiyuan.enterprise.module',
} as const;

export const EnterpriseRendererMessageType = {
  Ready: 'ready',
  Initialize: 'initialize',
  SessionRequest: 'session-request',
  SessionResponse: 'session-response',
  ModelCatalogRequest: 'model-catalog-request',
  ModelCatalogResponse: 'model-catalog-response',
} as const;

export const EnterpriseRendererSessionOperation = {
  Snapshot: 'snapshot',
  Login: 'login',
  ChangePassword: 'change-password',
  Logout: 'logout',
} as const;

export type EnterpriseRendererSessionOperation =
  (typeof EnterpriseRendererSessionOperation)[keyof typeof EnterpriseRendererSessionOperation];

export type EnterpriseRendererLanguage = 'zh' | 'en';
export type EnterpriseRendererTheme = 'light' | 'dark';

export interface EnterpriseRendererReadyMessage {
  readonly source: typeof EnterpriseRendererMessageSource.Module;
  readonly apiVersion: 1;
  readonly type: typeof EnterpriseRendererMessageType.Ready;
}

export interface EnterpriseRendererInitializeMessage {
  readonly source: typeof EnterpriseRendererMessageSource.Host;
  readonly apiVersion: 1;
  readonly type: typeof EnterpriseRendererMessageType.Initialize;
  readonly surface: EnterpriseRendererSurface;
  readonly pageId: string | null;
  readonly language: EnterpriseRendererLanguage;
  readonly theme: EnterpriseRendererTheme;
  readonly session: EnterpriseSessionResult;
}

export type EnterpriseRendererSessionRequestMessage =
  | {
      readonly source: typeof EnterpriseRendererMessageSource.Module;
      readonly apiVersion: 1;
      readonly type: typeof EnterpriseRendererMessageType.SessionRequest;
      readonly requestId: string;
      readonly operation: typeof EnterpriseRendererSessionOperation.Snapshot;
    }
  | {
      readonly source: typeof EnterpriseRendererMessageSource.Module;
      readonly apiVersion: 1;
      readonly type: typeof EnterpriseRendererMessageType.SessionRequest;
      readonly requestId: string;
      readonly operation: typeof EnterpriseRendererSessionOperation.Login;
      readonly input: EnterprisePasswordLoginInput;
    }
  | {
      readonly source: typeof EnterpriseRendererMessageSource.Module;
      readonly apiVersion: 1;
      readonly type: typeof EnterpriseRendererMessageType.SessionRequest;
      readonly requestId: string;
      readonly operation: typeof EnterpriseRendererSessionOperation.ChangePassword;
      readonly input: EnterprisePasswordChangeInput;
    }
  | {
      readonly source: typeof EnterpriseRendererMessageSource.Module;
      readonly apiVersion: 1;
      readonly type: typeof EnterpriseRendererMessageType.SessionRequest;
      readonly requestId: string;
      readonly operation: typeof EnterpriseRendererSessionOperation.Logout;
    };

export interface EnterpriseRendererSessionResponseMessage {
  readonly source: typeof EnterpriseRendererMessageSource.Host;
  readonly apiVersion: 1;
  readonly type: typeof EnterpriseRendererMessageType.SessionResponse;
  readonly requestId: string;
  readonly result: EnterpriseSessionResult;
}

export interface EnterpriseRendererModelCatalogRequestMessage {
  readonly source: typeof EnterpriseRendererMessageSource.Module;
  readonly apiVersion: 1;
  readonly type: typeof EnterpriseRendererMessageType.ModelCatalogRequest;
  readonly requestId: string;
}

export type EnterpriseRendererModelCatalogResult =
  | { readonly ok: true; readonly models: readonly ManagedProviderCatalogModel[] }
  | { readonly ok: false };

export interface EnterpriseRendererModelCatalogResponseMessage {
  readonly source: typeof EnterpriseRendererMessageSource.Host;
  readonly apiVersion: 1;
  readonly type: typeof EnterpriseRendererMessageType.ModelCatalogResponse;
  readonly requestId: string;
  readonly result: EnterpriseRendererModelCatalogResult;
}
