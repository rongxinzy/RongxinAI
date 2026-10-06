import {
  ModelCapabilityStatus,
  ProviderName,
  type ModelCapabilities,
} from '../../../../shared/providers';
import type { AppConfig } from '../../../config';

export const CUSTOM_PROVIDER_KEYS = [
  'custom_0',
  'custom_1',
  'custom_2',
  'custom_3',
  'custom_4',
  'custom_5',
  'custom_6',
  'custom_7',
  'custom_8',
  'custom_9',
] as const;

export const providerKeys = [
  ...Object.values(ProviderName).filter(
    id => id !== ProviderName.Custom && id !== ProviderName.Zhiyuan,
  ),
  ...CUSTOM_PROVIDER_KEYS,
] as const;

export type BuiltinProviderType = ProviderName;
export type CustomProviderType = (typeof CUSTOM_PROVIDER_KEYS)[number];
export type ProviderType = BuiltinProviderType | CustomProviderType;
export type ProvidersConfig = NonNullable<AppConfig['providers']>;
export type ProviderConfig = ProvidersConfig[string];
export type Model = NonNullable<ProviderConfig['models']>[number];

export const NO_USER_KEY_PROVIDERS = new Set<ProviderType>([
  ProviderName.Zhiyuan,
  ProviderName.Ollama,
  ProviderName.LlamaCpp,
  'github-copilot',
]);

export const DEFAULT_CUSTOM_MODEL_CAPABILITIES: Partial<ModelCapabilities> = {
  toolCalling: ModelCapabilityStatus.Supported,
  imageInput: ModelCapabilityStatus.Unknown,
  videoInput: ModelCapabilityStatus.Unknown,
  audioInput: ModelCapabilityStatus.Unknown,
  documentInput: ModelCapabilityStatus.Unknown,
  reasoning: ModelCapabilityStatus.Unknown,
};

// MiniMax Portal OAuth constants
export const MINIMAX_OAUTH_CLIENT_ID = '78257093-7e40-4613-99e0-527b14b39113';
export const MINIMAX_OAUTH_SCOPE = 'group_id profile model.completion';
export const MINIMAX_OAUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:user_code';
export const MINIMAX_BASE_URL_CN = 'https://api.minimaxi.com/anthropic';
export const MINIMAX_BASE_URL_GLOBAL = 'https://api.minimax.io/anthropic';
export const MINIMAX_CODE_ENDPOINT_CN = 'https://api.minimaxi.com/oauth/code';
export const MINIMAX_CODE_ENDPOINT_GLOBAL = 'https://api.minimax.io/oauth/code';
export const MINIMAX_TOKEN_ENDPOINT_CN = 'https://api.minimaxi.com/oauth/token';
export const MINIMAX_TOKEN_ENDPOINT_GLOBAL = 'https://api.minimax.io/oauth/token';

export type MiniMaxRegion = 'cn' | 'global';
export type MiniMaxOAuthPhase =
  | { kind: 'idle' }
  | { kind: 'requesting_code' }
  | { kind: 'pending'; userCode: string; verificationUri: string }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export type OpenAIOAuthPhase =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; email?: string }
  | { kind: 'error'; message: string };

export type OpenAIOAuthStatus = { loggedIn: false } | { loggedIn: true; email?: string } | null;

export type CopilotAuthStatus =
  | 'idle'
  | 'requesting'
  | 'awaiting_user'
  | 'polling'
  | 'authenticated'
  | 'error';

export const LOCAL_MODEL_REFRESH_MIN_LOADING_DURATION_MS = 1_000;
