import type {
  EnterprisePasswordChangeInput,
  EnterprisePasswordLoginInput,
  EnterpriseSessionResult,
  ManagedProviderCatalogModel,
} from './host-contract.js';

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

export const EnterpriseRendererSurface = {
  SessionGate: 'session-gate',
  Settings: 'settings',
} as const;
export type EnterpriseRendererSurface =
  (typeof EnterpriseRendererSurface)[keyof typeof EnterpriseRendererSurface];

export const EnterpriseRendererLanguage = {
  Chinese: 'zh',
  English: 'en',
} as const;
export type EnterpriseRendererLanguage =
  (typeof EnterpriseRendererLanguage)[keyof typeof EnterpriseRendererLanguage];

export const EnterpriseRendererTheme = {
  Light: 'light',
  Dark: 'dark',
} as const;
export type EnterpriseRendererTheme =
  (typeof EnterpriseRendererTheme)[keyof typeof EnterpriseRendererTheme];

// Optional v1 appearance capability. Only theme data crosses the sandbox.
export const EnterpriseRendererThemeVariables = [
  '--zy-background',
  '--zy-foreground',
  '--zy-surface',
  '--zy-surface-foreground',
  '--zy-surface-raised',
  '--zy-surface-tertiary',
  '--zy-surface-overlay',
  '--zy-text-secondary',
  '--zy-text-muted',
  '--zy-border',
  '--zy-border-subtle',
  '--zy-input-border',
  '--zy-primary',
  '--zy-primary-strong',
  '--zy-primary-hover',
  '--zy-primary-muted',
  '--zy-primary-foreground',
  '--zy-accent',
  '--zy-accent-foreground',
  '--zy-success',
  '--zy-warning',
  '--zy-destructive',
  '--zy-destructive-foreground',
  '--zy-ring',
  '--zy-radius',
  '--zy-scroll-thumb',
  '--zy-scroll-thumb-hover',
  '--zy-style-font-sans',
  '--zy-style-font-heading',
  '--zy-style-font-mono',
] as const;
export type EnterpriseRendererThemeVariables = Partial<
  Record<(typeof EnterpriseRendererThemeVariables)[number], string>
>;

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
  readonly themeVariables?: EnterpriseRendererThemeVariables;
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
  | {
      readonly ok: true;
      readonly models: readonly ManagedProviderCatalogModel[];
    }
  | { readonly ok: false };

export interface EnterpriseRendererModelCatalogResponseMessage {
  readonly source: typeof EnterpriseRendererMessageSource.Host;
  readonly apiVersion: 1;
  readonly type: typeof EnterpriseRendererMessageType.ModelCatalogResponse;
  readonly requestId: string;
  readonly result: EnterpriseRendererModelCatalogResult;
}
