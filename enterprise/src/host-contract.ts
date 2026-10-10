export const ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION = 1 as const;
export const ZHIYUAN_ENTERPRISE_SESSION_CAPABILITY_API_VERSION = 1 as const;
export const ZHIYUAN_ENTERPRISE_RENDERER_CAPABILITY_API_VERSION = 1 as const;
export const ZHIYUAN_ENTERPRISE_SETTINGS_CAPABILITY_API_VERSION = 1 as const;
export const ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION = 1 as const;
export const ZHIYUAN_ENTERPRISE_SKILL_CAPABILITY_API_VERSION = 1 as const;

export const ModelCapabilityStatus = {
  Supported: 'supported',
  Unsupported: 'unsupported',
  Unknown: 'unknown',
} as const;
export type ModelCapabilityStatus =
  (typeof ModelCapabilityStatus)[keyof typeof ModelCapabilityStatus];

export interface ModelCapabilities {
  readonly toolCalling: ModelCapabilityStatus;
  readonly imageInput: ModelCapabilityStatus;
  readonly videoInput: ModelCapabilityStatus;
  readonly audioInput: ModelCapabilityStatus;
  readonly documentInput: ModelCapabilityStatus;
  readonly reasoning: ModelCapabilityStatus;
}

export type ProviderModelPiApi = 'anthropic-messages' | 'openai-completions' | 'openai-responses';
export type ProviderModelPiThinkingFormat =
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'together'
  | 'zai'
  | 'qwen'
  | 'chat-template'
  | 'qwen-chat-template'
  | 'string-thinking'
  | 'ant-ling';

export type ProviderModelPiThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export type ProviderModelPiThinkingLevelMap = Partial<
  Record<ProviderModelPiThinkingLevel, string | null>
>;

export interface ProviderModelPiRuntimeConfig {
  readonly api?: ProviderModelPiApi;
  readonly reasoning?: boolean;
  readonly thinkingLevelMap?: ProviderModelPiThinkingLevelMap;
  readonly compat?: {
    readonly supportsReasoningEffort?: boolean;
    readonly requiresReasoningContentOnAssistantMessages?: boolean;
    readonly thinkingFormat?: ProviderModelPiThinkingFormat;
  };
}

export interface ProviderConfig {
  enabled: boolean;
  userEnabled?: boolean;
  apiKey: string;
  baseUrl: string;
  apiFormat?: 'openai' | 'anthropic' | 'gemini';
  models?: Array<{
    id: string;
    name: string;
    /** Per-model endpoint override (e.g. managed gateway per-model route prefixes). */
    baseUrl?: string;
    supportsImage?: boolean;
    capabilities?: Partial<ModelCapabilities>;
    contextWindow?: number;
    contextTokens?: number;
    maxTokens?: number;
    piRuntime?: ProviderModelPiRuntimeConfig;
  }>;
  displayName?: string;
}

export interface ManagedProviderCatalogModel {
  readonly id: string;
  readonly displayName: string;
  readonly providerKey: string;
  readonly providerDisplayName: string;
  readonly capabilities?: Partial<ModelCapabilities>;
  readonly contextWindow?: number;
  readonly isDefault: boolean;
}

export const EnterpriseSessionStatus = {
  Unavailable: 'unavailable',
  SignedOut: 'signed-out',
  Recoverable: 'recoverable',
  Authenticated: 'authenticated',
} as const;

export type EnterpriseSessionIdentity = {
  readonly user: {
    readonly id: string;
    readonly displayName: string;
    readonly email?: string | null;
  };
  readonly enterprise: {
    readonly id: string;
    readonly name: string;
  };
  readonly roles: readonly string[];
  readonly sessionExpiresAt: string;
  readonly passwordChangeRequired: boolean;
};

export type EnterpriseSessionSnapshot =
  | { readonly status: typeof EnterpriseSessionStatus.Unavailable }
  | { readonly status: typeof EnterpriseSessionStatus.SignedOut }
  | { readonly status: typeof EnterpriseSessionStatus.Recoverable }
  | {
      readonly status: typeof EnterpriseSessionStatus.Authenticated;
      readonly identity: EnterpriseSessionIdentity;
    };

export type EnterpriseSessionErrorCode = 'UNAVAILABLE' | 'INVALID_INPUT' | 'OPERATION_FAILED';

export type EnterpriseSessionResult =
  | { readonly ok: true; readonly snapshot: EnterpriseSessionSnapshot }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: EnterpriseSessionErrorCode;
        readonly message: string;
      };
    };

export interface EnterprisePasswordLoginInput {
  readonly aepBaseUrl: string;
  /** Required non-empty by the host v1 session bridge; the extension derives
      the deployment from server metadata and ignores this value. */
  readonly enterpriseId: string;
  readonly username: string;
  readonly password: string;
}

export interface EnterprisePasswordChangeInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

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
  readonly id: string;
  readonly entrypoint: string;
  readonly labels: { readonly zh: string; readonly en: string };
}

export interface ZhiyuanEnterpriseSettingsHostCapability {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_SETTINGS_CAPABILITY_API_VERSION;
  registerPage(page: ZhiyuanEnterpriseSettingsPageRegistration): () => void;
}

export interface ZhiyuanManagedProviderSource {
  readonly providerKey: string;
  readonly exclusive: boolean;
  snapshot(): Promise<ProviderConfig>;
  onDidChange?(listener: () => void): () => void;
}

export interface ZhiyuanManagedProviderHostCapability {
  /** Negotiated host version: any version >= ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION is accepted. */
  readonly apiVersion: number;
  registerSource(source: ZhiyuanManagedProviderSource): () => void;
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

export interface ZhiyuanEnterpriseHostContext {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION;
  readonly appVersion: string;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly paths: { readonly resources: string; readonly userData: string };
  readonly capabilities: {
    readonly session: ZhiyuanEnterpriseSessionHostCapability | null;
    readonly renderer: ZhiyuanEnterpriseRendererHostCapability | null;
    readonly settings: ZhiyuanEnterpriseSettingsHostCapability | null;
    readonly managedProvider: ZhiyuanManagedProviderHostCapability | null;
    readonly skills: ZhiyuanEnterpriseSkillHostCapability | null;
  };
}

export interface ZhiyuanEnterpriseExtension {
  readonly apiVersion: typeof ZHIYUAN_ENTERPRISE_EXTENSION_API_VERSION;
  readonly id: string;
  initialize(context: ZhiyuanEnterpriseHostContext): Promise<void>;
  dispose(): Promise<void>;
}
