import type {
  EnterprisePasswordChangeInput,
  EnterprisePasswordLoginInput,
  EnterpriseSessionSnapshot,
} from '../../shared/enterpriseSession';

export const ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION = 1 as const;
export const ZHIYUAN_ENTERPRISE_SESSION_CAPABILITY_API_VERSION = 1 as const;
export const ZHIYUAN_ENTERPRISE_RENDERER_CAPABILITY_API_VERSION = 1 as const;
export const ZHIYUAN_ENTERPRISE_SETTINGS_CAPABILITY_API_VERSION = 1 as const;
export const ZHIYUAN_ENTERPRISE_SKILL_CAPABILITY_API_VERSION = 1 as const;

export interface ZhiyuanEnterpriseSessionProvider {
  snapshot(): EnterpriseSessionSnapshot | Promise<EnterpriseSessionSnapshot>;
  login(input: EnterprisePasswordLoginInput): Promise<EnterpriseSessionSnapshot>;
  changePassword(input: EnterprisePasswordChangeInput): Promise<EnterpriseSessionSnapshot>;
  logout(): Promise<EnterpriseSessionSnapshot>;
}

export interface ZhiyuanEnterpriseSessionHostCapability {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_SESSION_CAPABILITY_API_VERSION;
  registerProvider(provider: ZhiyuanEnterpriseSessionProvider): () => void;
}

export interface ZhiyuanEnterpriseRendererHostCapability {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_RENDERER_CAPABILITY_API_VERSION;
  registerSessionGate(entrypoint: string): () => void;
}

export interface ZhiyuanEnterpriseSettingsPageRegistration {
  readonly entrypoint: string;
  readonly labels: {
    readonly zh: string;
    readonly en: string;
  };
}

export interface ZhiyuanEnterpriseSettingsHostCapability {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_SETTINGS_CAPABILITY_API_VERSION;
  registerPage(page: ZhiyuanEnterpriseSettingsPageRegistration): () => void;
}

export interface ZhiyuanEnterpriseManagedSkillRegistration {
  readonly directory: string;
  notifyChanged(): void;
  unregister(): void;
}

export interface ZhiyuanEnterpriseSkillHostCapability {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_SKILL_CAPABILITY_API_VERSION;
  registerManagedRoot(): ZhiyuanEnterpriseManagedSkillRegistration;
}

export const ZhiyuanEnterpriseExtensionStatus = {
  Idle: 'idle',
  Absent: 'absent',
  Active: 'active',
  Failed: 'failed',
  Disposed: 'disposed',
} as const;

export type ZhiyuanEnterpriseExtensionStatus =
  (typeof ZhiyuanEnterpriseExtensionStatus)[keyof typeof ZhiyuanEnterpriseExtensionStatus];

export interface ZhiyuanEnterpriseHostContext {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION;
  readonly appVersion: string;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly paths: {
    readonly resources: string;
    readonly userData: string;
  };
  readonly capabilities: {
    readonly session: ZhiyuanEnterpriseSessionHostCapability | null;
    readonly renderer: ZhiyuanEnterpriseRendererHostCapability | null;
    readonly settings: ZhiyuanEnterpriseSettingsHostCapability | null;
    readonly skills: ZhiyuanEnterpriseSkillHostCapability | null;
  };
}

export interface ZhiyuanEnterpriseExtension {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION;
  readonly id: string;
  initialize(context: ZhiyuanEnterpriseHostContext): Promise<void>;
  dispose(): Promise<void>;
}

export interface ZhiyuanEnterpriseExtensionModule {
  createZhiyuanEnterpriseExtension():
    | ZhiyuanEnterpriseExtension
    | Promise<ZhiyuanEnterpriseExtension>;
}

export interface ZhiyuanEnterpriseExtensionSnapshot {
  readonly status: ZhiyuanEnterpriseExtensionStatus;
  readonly extensionId: string | null;
}
