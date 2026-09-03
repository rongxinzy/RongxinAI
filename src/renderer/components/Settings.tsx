import { Button } from '@shared/components/ui/button';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Input } from '@shared/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@shared/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { Textarea } from '@shared/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';
import { useReducedMotion } from 'motion/react';
import {
  Building2,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Pencil,
  PlusCircle,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import {
  isProviderEnabled,
  ModelCapabilityStatus,
  type ModelCapabilities,
  type DiscoveredProviderModel,
  type ProviderModelPiRuntimeConfig,
  ProviderName,
  ProviderRegistry,
} from '../../shared/providers';
import { type AppUpdateRuntimeState, AppUpdateStatus } from '../../shared/appUpdate/constants';
import {
  type AppConfig,
  defaultConfig,
  getProviderDisplayName,
  getVisibleProviders,
  isCustomProvider,
} from '../config';
import { SettingsToggleRow } from './common/SettingsToggleRow';
import {
  MODEL_CAPABILITY_FIELDS,
} from './settings/ModelCapabilitiesFields';
import { ProviderModelDiscoveryButton } from './settings/ProviderModelDiscoveryButton';
import {
  ModelConnectionStatus,
  useModelConnectionStatus,
} from './settings/useModelConnectionStatus';
import { shouldAutoDetectProviderModels } from './settings/providerModelAutoDetection';
import { APP_ID, EXPORT_FORMAT_TYPE, EXPORT_PASSWORD } from '../constants/app';
import { getProviderIcon } from '../providers/uiRegistry';
import { apiService } from '../services/api';
import { LLAMACPP_RUNNING_MODELS_CHANGED_EVENT } from '../services/availableModels';
import { configService } from '../services/config';
import { coworkService } from '../services/cowork';
import {
  decryptSecret,
  decryptWithPassword,
  EncryptedPayload,
  encryptWithPassword,
  PasswordEncryptedPayload,
} from '../services/encryption';
import { i18nService, LanguageType } from '../services/i18n';
import { imService } from '../services/im';
import { reconcileDefaultModelConfig } from '../services/modelConfigReconciliation';
import { mergeDiscoveredProviderModels } from '../services/providerModelDiscovery';
import {
  testProviderModelConnection,
  testProviderModelsSequentially,
} from '../services/providerModelConnection';
import { buildAppSettingsSavePatch, getSettingsSaveErrorMessage } from '../services/settingsSave';
import { formatShortcutLabel } from '../services/shortcutLabel';
import { themeService } from '../services/theme';
import { selectCoworkConfig } from '../store/selectors/coworkSelectors';
import Modal from './common/Modal';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import ErrorMessage from './ErrorMessage';
import { GitHubCopilotIcon } from './icons/providers';
import {
  SettingsAnimatedSlidersHorizontalIcon,
  type SettingsAnimatedSlidersHorizontalIconHandle,
} from './icons/SettingsAnimatedSlidersHorizontalIcon';
import {
  SettingsAnimatedCircleHelpIcon,
  type SettingsAnimatedCircleHelpIconHandle,
} from './icons/SettingsAnimatedCircleHelpIcon';
import {
  SettingsAnimatedBrainIcon,
  type SettingsAnimatedBrainIconHandle,
} from './icons/SettingsAnimatedBrainIcon';
import {
  SettingsAnimatedKeyboardIcon,
  type SettingsAnimatedKeyboardIconHandle,
} from './icons/SettingsAnimatedKeyboardIcon';
import {
  SettingsAnimatedMailCheckIcon,
  type SettingsAnimatedMailCheckIconHandle,
} from './icons/SettingsAnimatedMailCheckIcon';
import {
  SettingsAnimatedMessageCircleMoreIcon,
  type SettingsAnimatedMessageCircleMoreIconHandle,
} from './icons/SettingsAnimatedMessageCircleMoreIcon';
import {
  SettingsAnimatedSunMediumIcon,
  type SettingsAnimatedSunMediumIconHandle,
} from './icons/SettingsAnimatedSunMediumIcon';
import {
  SettingsAnimatedBoxIcon,
  type SettingsAnimatedBoxIconHandle,
} from './icons/SettingsAnimatedBoxIcon';
import IMSettings from './im/IMSettings';
import { EmailSettingsPage } from './settings/email/EmailSettingsPage';
import { ManagedMemorySettings } from './settings/memory/ManagedMemorySettings';
import { GeneralLanguageField } from './settings/general/GeneralLanguageField';
import {
  ProviderModelEditorDialog,
  type ProviderModelEditorDraft,
} from './settings/ProviderModelEditorDialog';
import {
  resolveDiscoveredModelContext,
  resolveOllamaRunningModelContext,
} from './settings/ollamaRuntimeMetadata';
import { localInferenceCompactButtonClass } from './localInference/constants';
import type { EmailSettingsHandle } from './settings/email/types';
import type { EnterpriseRendererSettingsPage } from '../../shared/enterpriseRenderer';
import { EnterpriseSettingsPage } from './enterprise/EnterpriseSettingsPage';
import {
  filterManagedModelSettingsTabs,
  resolveManagedModelSettingsTab,
} from '../services/managedModelUiPolicy';

type TabType =
  | 'general'
  | 'appearance'
  | 'model'
  | 'triage'
  | 'coworkMemory'
  | 'coworkAgent'
  | 'shortcuts'
  | 'im'
  | 'email'
  | 'about';
type EnterpriseTabType = `extension:${string}`;
type SettingsTabType = TabType | EnterpriseTabType;

const toEnterpriseTab = (pageId: string): EnterpriseTabType => `extension:${pageId}`;
const isEnterpriseTab = (tab: SettingsTabType): tab is EnterpriseTabType =>
  tab.startsWith('extension:');
const fromEnterpriseTab = (tab: EnterpriseTabType): string => tab.slice('extension:'.length);

type AnimatedIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

export type SettingsOpenOptions = {
  initialTab?: SettingsTabType;
  notice?: string;
  noticeI18nKey?: string;
  noticeExtra?: string;
};

interface SettingsProps extends SettingsOpenOptions {
  onClose: () => void;
  enterpriseConfig?: {
    ui?: Record<string, 'hide' | 'disable' | 'readonly'>;
    disableUpdate?: boolean;
  } | null;
  appUpdateState?: AppUpdateRuntimeState;
  managedModelsOnly?: boolean;
}

const CUSTOM_PROVIDER_KEYS = [
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

const OFFICIAL_WEBSITE_URL = 'https://www.rongxzyai.com';

const providerKeys = [
  ...Object.values(ProviderName).filter(id => id !== ProviderName.Custom),
  ...CUSTOM_PROVIDER_KEYS,
] as const;

type BuiltinProviderType = ProviderName;
type CustomProviderType = (typeof CUSTOM_PROVIDER_KEYS)[number];
type ProviderType = BuiltinProviderType | CustomProviderType;
type ProvidersConfig = NonNullable<AppConfig['providers']>;
type ProviderConfig = ProvidersConfig[string];
type Model = NonNullable<ProviderConfig['models']>[number];

const getCustomProviderLabel = (provider: string): string => {
  const index = Number(provider.replace('custom_', '')) + 1;
  const baseLabel = i18nService.t('customProviderDefaultName');
  return index === 1 || !Number.isFinite(index) ? baseLabel : `${baseLabel} ${index}`;
};
const resolveModelSupportsImageForProvider = (
  providerName: string,
  model: { id: string; supportsImage?: boolean },
): boolean =>
  ProviderRegistry.resolveModelSupportsImage(providerName, model.id, model.supportsImage);

const DEFAULT_CUSTOM_MODEL_CAPABILITIES: Partial<ModelCapabilities> = {
  toolCalling: ModelCapabilityStatus.Unknown,
  imageInput: ModelCapabilityStatus.Unknown,
  videoInput: ModelCapabilityStatus.Unknown,
  audioInput: ModelCapabilityStatus.Unknown,
  documentInput: ModelCapabilityStatus.Unknown,
  reasoning: ModelCapabilityStatus.Unknown,
};

const TOKENS_PER_K = 1024;
const LOCAL_MODEL_REFRESH_MIN_LOADING_DURATION_MS = 1_000;

const formatTokenK = (tokens?: number): string => {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return '';
  return String(Number((tokens / TOKENS_PER_K).toFixed(2)));
};

const formatDetectedTokenLimit = (tokens: number): string =>
  tokens >= TOKENS_PER_K ? `${formatTokenK(tokens)}K` : String(tokens);

const parseTokenK = (value: string): number | undefined => {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * TOKENS_PER_K);
};

interface ProviderExportEntry {
  enabled: boolean;
  userEnabled?: boolean;
  apiKey: PasswordEncryptedPayload;
  baseUrl: string;
  apiFormat?: 'anthropic' | 'openai' | 'gemini';
  codingPlanEnabled?: boolean;
  models?: Model[];
}

interface ProvidersExportPayload {
  type: typeof EXPORT_FORMAT_TYPE;
  version: 2;
  exportedAt: string;
  encryption: {
    algorithm: 'AES-GCM';
    keySource: 'password';
    keyDerivation: 'PBKDF2';
  };
  providers: Record<string, ProviderExportEntry>;
}

interface ProvidersImportEntry {
  enabled?: boolean;
  userEnabled?: boolean;
  apiKey?: EncryptedPayload | PasswordEncryptedPayload | string;
  apiKeyEncrypted?: string;
  apiKeyIv?: string;
  baseUrl?: string;
  apiFormat?: 'anthropic' | 'openai' | 'native';
  codingPlanEnabled?: boolean;
  models?: Model[];
}

interface ProvidersImportPayload {
  type?: string;
  version?: number;
  encryption?: {
    algorithm?: string;
    keySource?: string;
    keyDerivation?: string;
  };
  providers?: Record<string, ProvidersImportEntry>;
}

const LOCAL_NO_KEY_PROVIDERS = new Set<ProviderType>([
  ProviderName.Ollama,
  ProviderName.LlamaCpp,
  'github-copilot',
]);

const providerRequiresApiKey = (provider: ProviderType) =>
  !LOCAL_NO_KEY_PROVIDERS.has(provider) && !isCustomProvider(provider);
const hasProviderAuthConfigured = (provider: ProviderType, config: ProviderConfig): boolean => {
  if (isCustomProvider(provider)) {
    return config.baseUrl.trim().length > 0;
  }
  if (provider === ProviderName.Ollama || provider === ProviderName.LlamaCpp) {
    return true;
  }

  if (provider === 'minimax') {
    if (config.authType === 'apikey') {
      return config.apiKey.trim().length > 0;
    }
    return (config.oauthAccessToken?.trim().length ?? 0) > 0;
  }

  // OpenAI in OAuth mode stores tokens in <CODEX_HOME>/auth.json (read by the
  // OAuth token store), not in the provider config — `authType === 'oauth'`
  // alone is the signal that ChatGPT login completed.
  if (provider === 'openai' && config.authType === 'oauth') {
    return true;
  }

  return config.apiKey.trim().length > 0;
};
const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.trim().replace(/\/+$/, '').toLowerCase();
const normalizeApiFormat = (value: unknown): 'anthropic' | 'openai' =>
  value === 'openai' ? 'openai' : 'anthropic';

// MiniMax Portal OAuth constants
const MINIMAX_OAUTH_CLIENT_ID = '78257093-7e40-4613-99e0-527b14b39113';
const MINIMAX_OAUTH_SCOPE = 'group_id profile model.completion';
const MINIMAX_OAUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:user_code';
const MINIMAX_BASE_URL_CN = 'https://api.minimaxi.com/anthropic';
const MINIMAX_BASE_URL_GLOBAL = 'https://api.minimax.io/anthropic';
const MINIMAX_CODE_ENDPOINT_CN = 'https://api.minimaxi.com/oauth/code';
const MINIMAX_CODE_ENDPOINT_GLOBAL = 'https://api.minimax.io/oauth/code';
const MINIMAX_TOKEN_ENDPOINT_CN = 'https://api.minimaxi.com/oauth/token';
const MINIMAX_TOKEN_ENDPOINT_GLOBAL = 'https://api.minimax.io/oauth/token';

type MiniMaxRegion = 'cn' | 'global';
type MiniMaxOAuthPhase =
  | { kind: 'idle' }
  | { kind: 'requesting_code' }
  | { kind: 'pending'; userCode: string; verificationUri: string }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

async function generateMiniMaxPkce(): Promise<{
  verifier: string;
  challenge: string;
  state: string;
}> {
  const verifierArray = new Uint8Array(32);
  crypto.getRandomValues(verifierArray);
  const verifier = btoa(String.fromCharCode(...verifierArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const stateArray = new Uint8Array(16);
  crypto.getRandomValues(stateArray);
  const state = btoa(String.fromCharCode(...stateArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return { verifier, challenge, state };
}

const getFixedApiFormatForProvider = (
  provider: string,
): 'anthropic' | 'openai' | 'gemini' | null => {
  if (provider === 'openai' || provider === 'stepfun') {
    return 'openai';
  }
  if (provider === 'github-copilot' || provider === 'qianfan') {
    return 'openai';
  }
  // Moonshot /anthropic endpoint does not fully implement the Anthropic Messages
  // spec (tool use, streaming, etc.), so the Claude Agent SDK cannot use it.
  // Force OpenAI format — requests go through the built-in compat proxy instead.
  if (provider === 'moonshot') {
    return 'openai';
  }
  if (provider === 'anthropic') {
    return 'anthropic';
  }
  if (provider === 'gemini') {
    return 'gemini';
  }
  return null;
};
const getEffectiveApiFormat = (
  provider: string,
  value: unknown,
): 'anthropic' | 'openai' | 'gemini' =>
  getFixedApiFormatForProvider(provider) ?? normalizeApiFormat(value);
const shouldShowApiFormatSelector = (provider: string): boolean =>
  getFixedApiFormatForProvider(provider) === null;
const getProviderDefaultBaseUrl = (
  provider: ProviderType,
  apiFormat: 'anthropic' | 'openai' | 'gemini',
): string | null => {
  if (apiFormat === 'gemini') return null;
  return ProviderRegistry.getSwitchableBaseUrl(provider, apiFormat) ?? null;
};
const resolveBaseUrl = (
  provider: ProviderType,
  baseUrl: string,
  apiFormat: 'anthropic' | 'openai' | 'gemini',
): string => {
  if (baseUrl.trim()) {
    if (
      shouldAutoSwitchProviderBaseUrl(provider, baseUrl) &&
      (apiFormat === 'anthropic' || apiFormat === 'openai')
    ) {
      const switchedUrl = ProviderRegistry.getSwitchableBaseUrl(provider, apiFormat);
      if (switchedUrl) return switchedUrl;
    }
    return baseUrl;
  }
  return (
    getProviderDefaultBaseUrl(provider, apiFormat) ||
    defaultConfig.providers?.[provider]?.baseUrl ||
    ''
  );
};
const shouldAutoSwitchProviderBaseUrl = (
  provider: ProviderType,
  currentBaseUrl: string,
): boolean => {
  const anthropicUrl = ProviderRegistry.getSwitchableBaseUrl(provider, 'anthropic');
  const openaiUrl = ProviderRegistry.getSwitchableBaseUrl(provider, 'openai');
  if (!anthropicUrl && !openaiUrl) {
    return false;
  }

  const normalizedCurrent = normalizeBaseUrl(currentBaseUrl);
  return (
    (anthropicUrl ? normalizedCurrent === normalizeBaseUrl(anthropicUrl) : false) ||
    (openaiUrl ? normalizedCurrent === normalizeBaseUrl(openaiUrl) : false)
  );
};
const shouldShowProviderModels = (providerKey: string, providerConfig: ProviderConfig): boolean => {
  if (providerKey === ProviderName.Ollama || providerKey === ProviderName.LlamaCpp) return true;
  if (isCustomProvider(providerKey)) return Boolean(providerConfig.baseUrl?.trim());
  return Boolean(providerConfig.apiKey?.trim());
};

const getDefaultProviders = (): ProvidersConfig => {
  const providers = (defaultConfig.providers ?? {}) as ProvidersConfig;
  const entries = Object.entries(providers) as Array<[string, ProviderConfig]>;
  const secureSuffix = i18nService.t('modelSuffixSecure');
  return Object.fromEntries(
    entries.map(([providerKey, providerConfig]) => [
      providerKey,
      {
        ...providerConfig,
        models: providerConfig.enabled
          ? providerConfig.models?.map(model => ({
              ...model,
              name: model.name.replace('(Secure)', secureSuffix),
              supportsImage: resolveModelSupportsImageForProvider(providerKey, model),
            }))
          : [],
      },
    ]),
  ) as ProvidersConfig;
};

const getDefaultActiveProvider = (): ProviderType => {
  const providers = (defaultConfig.providers ?? {}) as ProvidersConfig;
  const visibleProviderKeys = providerKeys;
  const firstEnabledProvider = visibleProviderKeys.find(providerKey =>
    isProviderEnabled(providerKey, providers[providerKey]),
  );
  return firstEnabledProvider ?? visibleProviderKeys[0];
};

const normalizeProviderModelsForSettings = (
  providerKey: string,
  models: ProviderConfig['models'],
): ProviderConfig['models'] =>
  models?.map((model, idx) => {
    let id = model.id;
    if (providerKey === 'qwen' && (id === 'vision-model' || id === 'coder-model')) {
      const defaultModel = defaultConfig.providers?.qwen?.models?.[idx];
      id = defaultModel?.id || (model.supportsImage ? 'qwen3.5-plus' : 'qwen3-coder-plus');
    }
    return {
      ...model,
      id,
      supportsImage: ProviderRegistry.resolveModelSupportsImage(
        providerKey,
        id,
        model.supportsImage,
      ),
    };
  });

// System shortcuts that should not be captured (clipboard, undo, select-all, quit, etc.)
const isSystemShortcut = (e: KeyboardEvent): boolean => {
  const key = e.key.toLowerCase();
  if (e.metaKey && ['c', 'v', 'x', 'z', 'y', 'a', 'q', 'w'].includes(key)) return true;
  if (e.metaKey && e.shiftKey && key === 'z') return true;
  if (e.ctrlKey && ['c', 'v', 'x', 'z', 'y', 'a', 'w'].includes(key)) return true;
  return false;
};

const formatShortcutFromEvent = (e: React.KeyboardEvent): string | null => {
  // Skip standalone modifier keys
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  // Require at least one non-Shift modifier
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return null;
  if (isSystemShortcut(e.nativeEvent)) return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const keyMap: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ' ': 'Space',
    Escape: 'Esc',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab',
  };
  const key = keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(key);
  return parts.join('+');
};

const SEND_SHORTCUT_OPTIONS = [
  { value: 'Enter', label: 'Enter', labelMac: 'Enter' },
  { value: 'Shift+Enter', label: 'Shift+Enter', labelMac: 'Shift+Enter' },
  { value: 'Ctrl+Enter', label: 'Ctrl+Enter', labelMac: 'Cmd+Enter' },
  { value: 'Alt+Enter', label: 'Alt+Enter', labelMac: 'Option+Enter' },
] as const;

const isMacPlatform = navigator.platform.includes('Mac');

const ShortcutRecorder: React.FC<{ value: string; onChange: (v: string) => void }> = ({
  value,
  onChange,
}) => {
  const [recording, setRecording] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecording(false);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      onChange('');
      setRecording(false);
      return;
    }
    const shortcut = formatShortcutFromEvent(e);
    if (shortcut) {
      onChange(shortcut);
      setRecording(false);
    }
  };

  useEffect(() => {
    if (!recording) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) setRecording(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [recording]);

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="outline"
      data-shortcut-input="true"
      onKeyDown={handleKeyDown}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      className={`w-36 justify-center px-3 py-1.5 text-sm font-normal select-none transition-colors
        bg-surface-raised text-foreground
        ${
          recording
            ? 'border-primary ring-1 ring-primary/30 text-muted-foreground'
            : 'border-border hover:border-primary/50'
        }`}
    >
      {value ? formatShortcutLabel(value, isMacPlatform) : i18nService.t('shortcutNotSet')}
    </Button>
  );
};

const SendShortcutSelect: React.FC<{ value: string; onChange: (v: string) => void }> = ({
  value,
  onChange,
}) => {
  const currentLabel = (() => {
    const opt = SEND_SHORTCUT_OPTIONS.find(o => o.value === value);
    if (!opt) return value;
    return isMacPlatform ? opt.labelMac : opt.label;
  })();

  return (
    <Select value={value} onValueChange={newValue => onChange(newValue ?? value)}>
      <SelectTrigger
        className="w-36 border border-border
          bg-surface-raised text-foreground
          px-3 py-1.5 text-sm"
      >
        <SelectValue placeholder={currentLabel} />
      </SelectTrigger>
      <SelectContent className="bg-surface-raised">
        {SEND_SHORTCUT_OPTIONS.map(option => {
          const label = isMacPlatform ? option.labelMac : option.label;
          return (
            <SelectItem
              key={option.value}
              value={option.value}
              className="text-sm text-foreground focus:bg-primary/10 focus:text-primary"
            >
              {label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

const Settings: React.FC<SettingsProps> = ({
  onClose,
  initialTab,
  notice,
  noticeI18nKey,
  noticeExtra,
  enterpriseConfig,
  appUpdateState,
  managedModelsOnly = false,
}) => {
  // 状态
  const [requestedActiveTab, setActiveTab] = useState<SettingsTabType>(initialTab ?? 'general');
  const [enterpriseSettingsPages, setEnterpriseSettingsPages] = useState<
    readonly EnterpriseRendererSettingsPage[]
  >([]);
  const enterpriseModelTab = enterpriseSettingsPages.find(page => page.id === 'models');
  const activeTab = resolveManagedModelSettingsTab(
    requestedActiveTab,
    managedModelsOnly,
    enterpriseModelTab ? toEnterpriseTab(enterpriseModelTab.id) : undefined,
  );
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [language, setLanguage] = useState<LanguageType>('zh');
  const [autoLaunch, setAutoLaunchState] = useState(false);
  const [useSystemProxy, setUseSystemProxy] = useState(false);
  const [sqliteAutoBackupEnabled, setSqliteAutoBackupEnabled] = useState(false);
  const [isUpdatingAutoLaunch, setIsUpdatingAutoLaunch] = useState(false);
  const [preventSleep, setPreventSleepState] = useState(false);
  const [isUpdatingPreventSleep, setIsUpdatingPreventSleep] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buildNoticeMessage = useCallback((): string | null => {
    if (noticeI18nKey) {
      const base = i18nService.t(noticeI18nKey);
      return noticeExtra ? `${base} (${noticeExtra})` : base;
    }
    return notice ?? null;
  }, [notice, noticeExtra, noticeI18nKey]);

  const [noticeMessage, setNoticeMessage] = useState<string | null>(() => buildNoticeMessage());
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<ProviderType | null>(null);
  const [pendingApiKeyClearProvider, setPendingApiKeyClearProvider] =
    useState<ProviderType | null>(null);
  const [pendingDeleteModel, setPendingDeleteModel] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [isImportingProviders, setIsImportingProviders] = useState(false);
  const [isExportingProviders, setIsExportingProviders] = useState(false);
  // Global triage defaults — Agent-level settings are per-Agent in AgentSettingsPanel
  const [triageCooldownRounds, setTriageCooldownRounds] = useState(3);
  const [triageMaxConversationRounds, setTriageMaxConversationRounds] = useState(20);
  const [triageUseLocalModel, setTriageUseLocalModel] = useState(false);
  const [triageModelName, setTriageModelName] = useState('');
  const initialThemeRef = useRef<'light' | 'dark' | 'system'>(themeService.getTheme());
  const initialLanguageRef = useRef<LanguageType>(i18nService.getLanguage());
  const didSaveRef = useRef(false);
  const emailSettingsRef = useRef<EmailSettingsHandle>(null);
  const generalIconRef = useRef<SettingsAnimatedSlidersHorizontalIconHandle>(null);
  const aboutIconRef = useRef<SettingsAnimatedCircleHelpIconHandle>(null);
  const shortcutsIconRef = useRef<SettingsAnimatedKeyboardIconHandle>(null);
  const memoryIconRef = useRef<SettingsAnimatedBrainIconHandle>(null);
  const emailIconRef = useRef<SettingsAnimatedMailCheckIconHandle>(null);
  const imIconRef = useRef<SettingsAnimatedMessageCircleMoreIconHandle>(null);
  const appearanceIconRef = useRef<SettingsAnimatedSunMediumIconHandle>(null);
  const modelIconRef = useRef<SettingsAnimatedBoxIconHandle>(null);
  const prefersReducedMotion = useReducedMotion();
  const settingsIconRefs: Partial<Record<SettingsTabType, { current: AnimatedIconHandle | null }>> =
    {
      general: generalIconRef,
      appearance: appearanceIconRef,
      model: modelIconRef,
      im: imIconRef,
      email: emailIconRef,
      coworkMemory: memoryIconRef,
      shortcuts: shortcutsIconRef,
      about: aboutIconRef,
    };

  useEffect(() => {
    let active = true;
    void window.electron.enterprise.renderer
      .settingsPages()
      .then(pages => {
        if (active) setEnterpriseSettingsPages(pages);
      })
      .catch(() => {
        if (active) setEnterpriseSettingsPages([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const startSettingsIconAnimation = (tab: SettingsTabType) => {
    if (!prefersReducedMotion) settingsIconRefs[tab]?.current?.startAnimation();
  };

  const stopSettingsIconAnimation = (tab: SettingsTabType) => {
    settingsIconRefs[tab]?.current?.stopAnimation();
  };

  // Add state for active provider
  const [activeProvider, setActiveProvider] = useState<ProviderType>(getDefaultActiveProvider());
  const [showApiKey, setShowApiKey] = useState(false);

  // MiniMax OAuth state
  const [minimaxOAuthPhase, setMinimaxOAuthPhase] = useState<MiniMaxOAuthPhase>({ kind: 'idle' });
  const [minimaxOAuthRegion, setMinimaxOAuthRegion] = useState<MiniMaxRegion>('cn');
  const minimaxOAuthCancelRef = useRef(false);

  // OpenAI ChatGPT (Codex) OAuth state
  type OpenAIOAuthPhase =
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'success'; email?: string }
    | { kind: 'error'; message: string };
  const [openaiOAuthPhase, setOpenaiOAuthPhase] = useState<OpenAIOAuthPhase>({ kind: 'idle' });
  // Mirrors <CODEX_HOME>/auth.json on disk; refreshed on tab focus and after
  // login/logout. `null` = not yet checked.
  const [openaiOAuthStatus, setOpenaiOAuthStatus] = useState<
    { loggedIn: false } | { loggedIn: true; email?: string } | null
  >(null);

  // Add state for providers configuration
  const [providers, setProviders] = useState<ProvidersConfig>(() => getDefaultProviders());
  const [selectedModelId, setSelectedModelId] = useState('');
  const [autoDetectRequest, setAutoDetectRequest] = useState<{
    provider: ProviderType;
    requestId: number;
  } | null>(null);
  const [isRefreshingLlamaCppModels, setIsRefreshingLlamaCppModels] = useState(false);
  const autoDetectRequestIdRef = useRef(0);
  const apiKeyInputDirtyRef = useRef<Partial<Record<ProviderType, boolean>>>({});
  const baseUrlInputDirtyRef = useRef<Partial<Record<ProviderType, boolean>>>({});
  const modelConnectionTestRequestIdRef = useRef<Partial<Record<ProviderType, number>>>({});
  const {
    getModelConnectionStatus,
    resetProviderModelConnectionStatuses,
    setModelConnectionStatus,
    setProviderModelConnectionStatuses,
  } = useModelConnectionStatus();

  const invalidateProviderModelConnectionStatuses = useCallback(
    (provider: ProviderType) => {
      modelConnectionTestRequestIdRef.current[provider] =
        (modelConnectionTestRequestIdRef.current[provider] ?? 0) + 1;
      resetProviderModelConnectionStatuses(provider);
    },
    [resetProviderModelConnectionStatuses],
  );

  // authType defaults to undefined on first open, which should behave as OAuth mode
  const minimaxIsOAuthMode = providers.minimax.authType !== 'apikey';
  // OpenAI defaults to API key mode unless the user explicitly opts in to OAuth
  const openaiIsOAuthMode = providers.openai.authType === 'oauth';
  const isBaseUrlLocked =
    (activeProvider === 'zhipu' && providers.zhipu.codingPlanEnabled) ||
    (activeProvider === 'qwen' && providers.qwen.codingPlanEnabled) ||
    (activeProvider === 'volcengine' && providers.volcengine.codingPlanEnabled) ||
    (activeProvider === 'moonshot' && providers.moonshot.codingPlanEnabled) ||
    (activeProvider === 'qianfan' && providers.qianfan.codingPlanEnabled) ||
    (activeProvider === 'xiaomi' && providers.xiaomi.codingPlanEnabled) ||
    (activeProvider === 'minimax' && minimaxIsOAuthMode) ||
    (activeProvider === 'openai' && openaiIsOAuthMode) ||
    activeProvider === ProviderName.LlamaCpp;

  // 创建引用来确保内容区域的滚动
  const contentRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  // 快捷键设置
  const [shortcuts, setShortcuts] = useState({
    ...defaultConfig.shortcuts!,
  });

  // GitHub Copilot device code auth state
  const [copilotAuthStatus, setCopilotAuthStatus] = useState<
    'idle' | 'requesting' | 'awaiting_user' | 'polling' | 'authenticated' | 'error'
  >('idle');
  const [copilotUserCode, setCopilotUserCode] = useState('');
  const [copilotVerificationUri, setCopilotVerificationUri] = useState('');
  const [copilotGithubUser, setCopilotGithubUser] = useState('');
  const [copilotError, setCopilotError] = useState<string | null>(null);

  // State for model editing
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [isEditingModel, setIsEditingModel] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [newModelName, setNewModelName] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [newModelContextWindow, setNewModelContextWindow] = useState('');
  const [newModelMaxTokens, setNewModelMaxTokens] = useState('');
  const [newModelCapabilities, setNewModelCapabilities] = useState<Partial<ModelCapabilities>>(
    DEFAULT_CUSTOM_MODEL_CAPABILITIES,
  );
  const [newModelPiRuntime, setNewModelPiRuntime] = useState<
    ProviderModelPiRuntimeConfig | undefined
  >(undefined);
  const [modelFormError, setModelFormError] = useState<string | null>(null);

  // About tab
  const [appVersion, setAppVersion] = useState('');
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  useEffect(() => {
    window.electron.appInfo.getVersion().then(setAppVersion);
  }, []);

  useEffect(() => {
    setShowApiKey(false);
  }, [activeProvider]);

  useEffect(() => {
    const models = providers[activeProvider]?.models ?? [];
    setSelectedModelId(current =>
      models.some(model => model.id === current) ? current : (models[0]?.id ?? ''),
    );
  }, [activeProvider, providers]);

  const handleExportLogs = useCallback(async () => {
    if (isExportingLogs) {
      return;
    }

    setError(null);
    setNoticeMessage(null);
    setIsExportingLogs(true);
    try {
      const result = await window.electron.log.exportZip();
      if (!result.success) {
        setError(result.error || i18nService.t('aboutExportLogsFailed'));
        return;
      }
      if (result.canceled) {
        return;
      }

      if (result.path) {
        await window.electron.shell.showItemInFolder(result.path);
      }

      if ((result.missingEntries?.length ?? 0) > 0) {
        const missingList = result.missingEntries?.join(', ') || '';
        setNoticeMessage(`${i18nService.t('aboutExportLogsPartial')}: ${missingList}`);
      } else {
        setNoticeMessage(i18nService.t('aboutExportLogsSuccess'));
      }
    } catch (exportError) {
      setError(
        exportError instanceof Error ? exportError.message : i18nService.t('aboutExportLogsFailed'),
      );
    } finally {
      setIsExportingLogs(false);
    }
  }, [isExportingLogs]);

  const coworkConfig = useSelector(selectCoworkConfig);

  const [embeddingEnabled, setEmbeddingEnabled] = useState<boolean>(
    coworkConfig.embeddingEnabled ?? false,
  );
  const [embeddingProvider, setEmbeddingProvider] = useState<string>(
    coworkConfig.embeddingProvider ?? 'openai',
  );
  const [embeddingModel, setEmbeddingModel] = useState<string>(coworkConfig.embeddingModel ?? '');
  const [embeddingLocalModelPath, setEmbeddingLocalModelPath] = useState<string>(
    coworkConfig.embeddingLocalModelPath ?? '',
  );
  const [embeddingVectorWeight, setEmbeddingVectorWeight] = useState<number>(
    coworkConfig.embeddingVectorWeight ?? 0.7,
  );
  const [embeddingRemoteBaseUrl, setEmbeddingRemoteBaseUrl] = useState<string>(
    coworkConfig.embeddingRemoteBaseUrl ?? '',
  );
  const [embeddingRemoteApiKey, setEmbeddingRemoteApiKey] = useState<string>(
    coworkConfig.embeddingRemoteApiKey ?? '',
  );
  const [bootstrapIdentity, setBootstrapIdentity] = useState<string>('');
  const [bootstrapUser, setBootstrapUser] = useState<string>('');
  const [bootstrapSoul, setBootstrapSoul] = useState<string>('');
  const [bootstrapLoaded, setBootstrapLoaded] = useState<boolean>(false);
  const [bootstrapTab, setBootstrapTab] = useState<'IDENTITY.md' | 'SOUL.md' | 'USER.md'>(
    'IDENTITY.md',
  );

  const syncLlamaCppProviderFromConfig = useCallback(async () => {
    const config = await configService.reload();
    const llamaCppProvider = config.providers?.[ProviderName.LlamaCpp];
    if (!llamaCppProvider) {
      return;
    }

    setProviders(prev => ({
      ...prev,
      [ProviderName.LlamaCpp]: {
        ...prev[ProviderName.LlamaCpp],
        ...llamaCppProvider,
        enabled: prev[ProviderName.LlamaCpp].enabled,
        userEnabled: prev[ProviderName.LlamaCpp].userEnabled,
        apiFormat: getEffectiveApiFormat(ProviderName.LlamaCpp, llamaCppProvider.apiFormat),
        models: normalizeProviderModelsForSettings(ProviderName.LlamaCpp, llamaCppProvider.models),
      },
    }));
  }, []);

  const handleRefreshLlamaCppModels = async (): Promise<void> => {
    if (isRefreshingLlamaCppModels) return;

    const loadingStartedAt = performance.now();
    setIsRefreshingLlamaCppModels(true);
    try {
      await window.electron.llamacpp.refreshRunningModelBindings();
      await syncLlamaCppProviderFromConfig();
    } catch (error) {
      console.error('[Settings] failed to refresh local model bindings:', error);
    } finally {
      const remainingLoadingDuration = Math.max(
        0,
        LOCAL_MODEL_REFRESH_MIN_LOADING_DURATION_MS - (performance.now() - loadingStartedAt),
      );
      if (remainingLoadingDuration > 0) {
        await new Promise<void>(resolve => {
          window.setTimeout(resolve, remainingLoadingDuration);
        });
      }
      setIsRefreshingLlamaCppModels(false);
    }
  };

  useEffect(() => {
    setEmbeddingEnabled(coworkConfig.embeddingEnabled ?? false);
    setEmbeddingProvider(coworkConfig.embeddingProvider ?? 'openai');
    setEmbeddingModel(coworkConfig.embeddingModel ?? '');
    setEmbeddingLocalModelPath(coworkConfig.embeddingLocalModelPath ?? '');
    setEmbeddingVectorWeight(coworkConfig.embeddingVectorWeight ?? 0.7);
    setEmbeddingRemoteBaseUrl(coworkConfig.embeddingRemoteBaseUrl ?? '');
    setEmbeddingRemoteApiKey(coworkConfig.embeddingRemoteApiKey ?? '');
  }, [
    coworkConfig.embeddingEnabled,
    coworkConfig.embeddingProvider,
    coworkConfig.embeddingModel,
    coworkConfig.embeddingLocalModelPath,
    coworkConfig.embeddingVectorWeight,
    coworkConfig.embeddingRemoteBaseUrl,
    coworkConfig.embeddingRemoteApiKey,
  ]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const config = await configService.reload();
        if (!active) return;

        // Set general settings
        initialThemeRef.current = config.theme;
        initialLanguageRef.current = config.language;
        setTheme(config.theme);
        setLanguage(config.language);
        setUseSystemProxy(config.useSystemProxy ?? false);
        setSqliteAutoBackupEnabled(config.sqliteAutoBackupEnabled === true);

        // Load auto-launch setting
        window.electron.autoLaunch
          .get()
          .then(({ enabled }) => {
            if (active) {
              setAutoLaunchState(enabled);
            }
          })
          .catch(err => {
            console.error('Failed to load auto-launch setting:', err);
          });

        // Load prevent-sleep setting
        window.electron.preventSleep
          .get()
          .then(({ enabled }) => {
            if (active) {
              setPreventSleepState(enabled);
            }
          })
          .catch(err => {
            console.error('Failed to load prevent-sleep setting:', err);
          });

        // Set up providers based on saved config
        if (config.api) {
          // For backward compatibility with older config
          // Initialize active provider based on baseUrl
          const normalizedApiBaseUrl = config.api.baseUrl.toLowerCase();
          if (normalizedApiBaseUrl.includes('openai')) {
            setActiveProvider('openai');
            setProviders(prev => ({
              ...prev,
              openai: {
                ...prev.openai,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('deepseek')) {
            setActiveProvider('deepseek');
            setProviders(prev => ({
              ...prev,
              deepseek: {
                ...prev.deepseek,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (
            normalizedApiBaseUrl.includes('moonshot.ai') ||
            normalizedApiBaseUrl.includes('moonshot.cn')
          ) {
            setActiveProvider('moonshot');
            setProviders(prev => ({
              ...prev,
              moonshot: {
                ...prev.moonshot,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('bigmodel.cn')) {
            setActiveProvider('zhipu');
            setProviders(prev => ({
              ...prev,
              zhipu: {
                ...prev.zhipu,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('minimax')) {
            setActiveProvider('minimax');
            setProviders(prev => ({
              ...prev,
              minimax: {
                ...prev.minimax,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('dashscope')) {
            setActiveProvider('qwen');
            setProviders(prev => ({
              ...prev,
              qwen: {
                ...prev.qwen,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('stepfun')) {
            setActiveProvider('stepfun');
            setProviders(prev => ({
              ...prev,
              stepfun: {
                ...prev.stepfun,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('openrouter.ai')) {
            setActiveProvider('openrouter');
            setProviders(prev => ({
              ...prev,
              openrouter: {
                ...prev.openrouter,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('googleapis')) {
            setActiveProvider('gemini');
            setProviders(prev => ({
              ...prev,
              gemini: {
                ...prev.gemini,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (normalizedApiBaseUrl.includes('anthropic')) {
            setActiveProvider('anthropic');
            setProviders(prev => ({
              ...prev,
              anthropic: {
                ...prev.anthropic,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          } else if (
            normalizedApiBaseUrl.includes('ollama') ||
            normalizedApiBaseUrl.includes('11434')
          ) {
            setActiveProvider('ollama');
            setProviders(prev => ({
              ...prev,
              ollama: {
                ...prev.ollama,
                enabled: true,
                apiKey: config.api.key,
                baseUrl: config.api.baseUrl,
              },
            }));
          }
        }

        // Load provider-specific configurations if available
        // 合并已保存的配置和默认配置，确保新添加的 provider 能被显示
        if (config.providers) {
          setProviders(prev => {
            const merged = {
              ...prev, // 保留默认的 providers（包括新添加的 anthropic）
              ...config.providers, // 覆盖已保存的配置
            };

            // After merging, find the first enabled provider to set as activeProvider
            // This ensures we don't use stale activeProvider from old config.api.baseUrl
            const firstEnabledProvider = providerKeys.find(providerKey =>
              isProviderEnabled(providerKey, merged[providerKey]),
            );
            if (firstEnabledProvider) {
              setActiveProvider(firstEnabledProvider);
            }

            return Object.fromEntries(
              Object.entries(merged).map(([providerKey, providerConfig]) => {
                const models = shouldShowProviderModels(providerKey, providerConfig)
                  ? normalizeProviderModelsForSettings(providerKey, providerConfig.models)
                  : [];
                return [
                  providerKey,
                  {
                    ...providerConfig,
                    enabled: isProviderEnabled(providerKey, providerConfig),
                    userEnabled:
                      providerKey === ProviderName.LlamaCpp
                        ? providerConfig.userEnabled === true
                        : providerConfig.userEnabled,
                    apiFormat: getEffectiveApiFormat(
                      providerKey,
                      (providerConfig as ProviderConfig).apiFormat,
                    ),
                    models,
                  },
                ];
              }),
            ) as ProvidersConfig;
          });
        }

        // 加载快捷键设置
        if (config.shortcuts) {
          setShortcuts(prev => ({
            ...prev,
            ...config.shortcuts,
          }));
        }
      } catch {
        if (active) {
          setError('Failed to load settings');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleLlamaCppRunningModelsChanged = () => {
      void syncLlamaCppProviderFromConfig().catch(() => undefined);
    };

    window.addEventListener(
      LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
      handleLlamaCppRunningModelsChanged,
    );
    return () => {
      window.removeEventListener(
        LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
        handleLlamaCppRunningModelsChanged,
      );
    };
  }, [syncLlamaCppProviderFromConfig]);

  useEffect(() => {
    const initialTheme = initialThemeRef.current;
    const initialLanguage = initialLanguageRef.current;
    return () => {
      if (didSaveRef.current) {
        return;
      }
      themeService.setTheme(initialTheme);
      i18nService.setLanguage(initialLanguage, { persist: false });
    };
  }, []);

  useEffect(() => {
    window.electron.triage
      .getConfig()
      .then(config => {
        setTriageCooldownRounds(config.rules.cooldownRounds);
        setTriageMaxConversationRounds(config.rules.maxConversationRoundsForTriage);
        setTriageUseLocalModel(config.rules.useLocalModelTriage);
        setTriageModelName(config.rules.triageModelName);
      })
      .catch(() => {
        /* triage not available */
      });
  }, []);

  // 监听标签页切换，确保内容区域滚动到顶部
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    setNoticeMessage(buildNoticeMessage());
  }, [buildNoticeMessage]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18nService.subscribe(() => {
      setLanguage(i18nService.getLanguage());
      // Re-translate notice message on language change
      if (noticeI18nKey) {
        const base = i18nService.t(noticeI18nKey);
        setNoticeMessage(noticeExtra ? `${base} (${noticeExtra})` : base);
      }
    });
    return unsubscribe;
  }, [noticeI18nKey, noticeExtra]);

  // Compute visible providers based on language, including active custom_N entries
  const visibleProviders = useMemo(() => {
    const visibleKeys = getVisibleProviders(language);
    const filtered: Partial<ProvidersConfig> = {};
    for (const key of visibleKeys) {
      if (providers[key as keyof ProvidersConfig]) {
        filtered[key as keyof ProvidersConfig] = providers[key as keyof ProvidersConfig];
      }
    }
    // Append custom_N providers that exist in state, sorted by numeric suffix
    for (const key of CUSTOM_PROVIDER_KEYS) {
      if (providers[key]) {
        filtered[key] = providers[key];
      }
    }
    // Keep the selected provider available while switching locales. Provider visibility
    // is region-based, so otherwise switching languages could unexpectedly change tabs.
    if (providers[activeProvider] && !filtered[activeProvider]) {
      const activeConfig = providers[activeProvider];
      // Keep a provider across locale changes only when the user has actually
      // enabled or configured it. Disabled preset providers must not appear
      // as a lone entry in the provider list.
      if (
        isProviderEnabled(activeProvider, activeConfig) ||
        hasProviderAuthConfigured(activeProvider, activeConfig)
      ) {
        filtered[activeProvider] = activeConfig;
      }
    }
    return filtered as ProvidersConfig;
  }, [activeProvider, language, providers]);

  // Ensure activeProvider is always in visibleProviders when language changes
  useEffect(() => {
    const visibleKeys = Object.keys(visibleProviders) as ProviderType[];
    if (visibleKeys.length > 0 && !visibleKeys.includes(activeProvider)) {
      // If current activeProvider is not visible, switch to first visible provider
      const firstEnabledVisible = visibleKeys.find(key =>
        isProviderEnabled(key, visibleProviders[key]),
      );
      setActiveProvider(firstEnabledVisible ?? visibleKeys[0]);
    }
  }, [visibleProviders, activeProvider]);

  // Handle adding a new custom provider
  const handleAddCustomProvider = () => {
    // Find the first unused custom slot
    const usedKeys = new Set(Object.keys(providers));
    const newKey = CUSTOM_PROVIDER_KEYS.find(k => !usedKeys.has(k));
    if (!newKey) return; // All 10 slots used
    setProviders(prev => ({
      ...prev,
      [newKey]: {
        enabled: false,
        apiKey: '',
        baseUrl: '',
        apiFormat: 'openai' as const,
        models: [],
        displayName: undefined,
      },
    }));
    setActiveProvider(newKey);
    setShowApiKey(false);
    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
    setNewModelContextWindow('');
    setNewModelMaxTokens('');
    setModelFormError(null);
  };

  // Handle deleting a custom provider
  const handleDeleteCustomProvider = (key: ProviderType) => {
    setPendingDeleteProvider(key);
  };

  const confirmDeleteCustomProvider = () => {
    const key = pendingDeleteProvider;
    if (!key) return;
    setPendingDeleteProvider(null);
    setProviders(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    // Persist the deletion immediately so it survives window close
    const currentConfig = configService.getConfig();
    const updatedProviders = { ...currentConfig.providers };
    delete updatedProviders[key];
    configService.updateConfig({ providers: updatedProviders as AppConfig['providers'] });
    // If the deleted provider was active, switch to first visible
    if (activeProvider === key) {
      const visibleKeys = Object.keys(visibleProviders).filter(k => k !== key) as ProviderType[];
      const firstEnabled = visibleKeys.find(k => isProviderEnabled(k, visibleProviders[k]));
      setActiveProvider(firstEnabled ?? visibleKeys[0] ?? providerKeys[0]);
    }
  };

  // Handle provider change
  const handleProviderChange = (provider: ProviderType) => {
    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
    setModelFormError(null);
    setActiveProvider(provider);
    setSelectedModelId('');
  };

  // Handle provider configuration change
  const handleProviderConfigChange = (provider: ProviderType, field: string, value: string) => {
    if (field === 'apiKey' || field === 'baseUrl' || field === 'apiFormat') {
      invalidateProviderModelConnectionStatuses(provider);
    }
    if (field === 'apiFormat') {
      const currentProviderConfig = providers[provider];
      const nextApiFormat = getEffectiveApiFormat(provider, value);
      const nextBaseUrl = shouldAutoSwitchProviderBaseUrl(provider, currentProviderConfig.baseUrl)
        ? getProviderDefaultBaseUrl(provider, nextApiFormat) || currentProviderConfig.baseUrl
        : currentProviderConfig.baseUrl;
      if (
        shouldAutoDetectProviderModels({
          providerId: provider,
          baseUrl: nextBaseUrl,
          apiKey: currentProviderConfig.apiKey,
          authType: currentProviderConfig.authType,
          requiresApiKey: providerRequiresApiKey(provider),
        })
      ) {
        setAutoDetectRequest({
          provider,
          requestId: ++autoDetectRequestIdRef.current,
        });
      }
    }
    setProviders(prev => {
      if (field === 'apiFormat') {
        const nextApiFormat = getEffectiveApiFormat(provider, value);
        const nextProviderConfig: ProviderConfig = {
          ...prev[provider],
          apiFormat: nextApiFormat,
        };

        // Only auto-switch URL when current value is still a known default URL.
        if (shouldAutoSwitchProviderBaseUrl(provider, prev[provider].baseUrl)) {
          const defaultBaseUrl = getProviderDefaultBaseUrl(provider, nextApiFormat);
          if (defaultBaseUrl) {
            nextProviderConfig.baseUrl = defaultBaseUrl;
          }
        }

        return {
          ...prev,
          [provider]: nextProviderConfig,
        };
      }

      // Handle codingPlanEnabled toggle for all supported providers
      if (field === 'codingPlanEnabled') {
        const def = ProviderRegistry.get(provider);
        if (def?.codingPlanSupported) {
          const enabled = value === 'true';
          const nextModels =
            enabled && def.codingPlanModels
              ? def.codingPlanModels.map(m => ({ ...m }))
              : def.defaultModels.map(m => ({ ...m }));
          return {
            ...prev,
            [provider]: {
              ...prev[provider],
              codingPlanEnabled: enabled,
              models: nextModels,
            },
          };
        }
      }

      return {
        ...prev,
        [provider]: {
          ...prev[provider],
          [field]: value,
        },
      };
    });
  };

  const handleApiKeyInputChange = (provider: ProviderType, value: string) => {
    apiKeyInputDirtyRef.current[provider] = true;
    handleProviderConfigChange(provider, 'apiKey', value);
  };

  const handleBaseUrlInputChange = (provider: ProviderType, value: string) => {
    baseUrlInputDirtyRef.current[provider] = true;
    handleProviderConfigChange(provider, 'baseUrl', value);
  };

  const requestApiKeyClear = (provider: ProviderType) => {
    if (!providers[provider].apiKey) return;
    setPendingApiKeyClearProvider(provider);
  };

  const confirmApiKeyClear = () => {
    const provider = pendingApiKeyClearProvider;
    if (!provider) return;
    setPendingApiKeyClearProvider(null);
    handleApiKeyInputChange(provider, '');
  };

  const handleApiKeyBlur = (provider: ProviderType) => {
    const providerConfig = providers[provider];
    const wasEdited = apiKeyInputDirtyRef.current[provider] === true;
    apiKeyInputDirtyRef.current[provider] = false;
    if (
      !wasEdited ||
      !providerRequiresApiKey(provider) ||
      providerConfig.authType === 'oauth' ||
      !providerConfig.apiKey.trim() ||
      !providerConfig.baseUrl.trim()
    ) {
      return;
    }
    setAutoDetectRequest({
      provider,
      requestId: ++autoDetectRequestIdRef.current,
    });
  };

  const handleBaseUrlBlur = (provider: ProviderType) => {
    const wasEdited = baseUrlInputDirtyRef.current[provider] === true;
    baseUrlInputDirtyRef.current[provider] = false;
    if (!wasEdited || provider !== ProviderName.Ollama || !providers[provider].baseUrl.trim()) {
      return;
    }
    setAutoDetectRequest({
      provider,
      requestId: ++autoDetectRequestIdRef.current,
    });
  };

  const handleMiniMaxDeviceLogin = async (region: MiniMaxRegion) => {
    minimaxOAuthCancelRef.current = false;
    setMinimaxOAuthPhase({ kind: 'requesting_code' });

    const codeEndpoint = region === 'cn' ? MINIMAX_CODE_ENDPOINT_CN : MINIMAX_CODE_ENDPOINT_GLOBAL;
    const tokenEndpoint =
      region === 'cn' ? MINIMAX_TOKEN_ENDPOINT_CN : MINIMAX_TOKEN_ENDPOINT_GLOBAL;
    const defaultBaseUrl = region === 'cn' ? MINIMAX_BASE_URL_CN : MINIMAX_BASE_URL_GLOBAL;

    try {
      const { verifier, challenge, state } = await generateMiniMaxPkce();

      const codeBody = [
        'response_type=code',
        `client_id=${encodeURIComponent(MINIMAX_OAUTH_CLIENT_ID)}`,
        `scope=${encodeURIComponent(MINIMAX_OAUTH_SCOPE)}`,
        `code_challenge=${encodeURIComponent(challenge)}`,
        'code_challenge_method=S256',
        `state=${encodeURIComponent(state)}`,
      ].join('&');

      const codeRes = await window.electron.api.fetch({
        url: codeEndpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: codeBody,
      });

      if (!codeRes.ok) {
        throw new Error(`MiniMax OAuth authorization failed: ${codeRes.status}`);
      }

      const codePayload = (codeRes.data ?? {}) as {
        user_code?: string;
        verification_uri?: string;
        expired_in?: number;
        interval?: number;
        state?: string;
        error?: string;
      };

      if (!codePayload.user_code || !codePayload.verification_uri) {
        throw new Error(
          codePayload.error ?? 'MiniMax OAuth returned incomplete authorization payload',
        );
      }

      if (codePayload.state !== state) {
        throw new Error('MiniMax OAuth state mismatch: possible CSRF attack or session corruption');
      }

      try {
        await window.electron.shell.openExternal(codePayload.verification_uri);
      } catch {
        /* ignore: user can open manually */
      }

      setMinimaxOAuthPhase({
        kind: 'pending',
        userCode: codePayload.user_code,
        verificationUri: codePayload.verification_uri,
      });

      let pollIntervalMs = codePayload.interval ?? 2000;
      const expireTimeMs = codePayload.expired_in ?? Date.now() + 5 * 60 * 1000;

      while (Date.now() < expireTimeMs) {
        if (minimaxOAuthCancelRef.current) {
          setMinimaxOAuthPhase({ kind: 'idle' });
          return;
        }

        await new Promise(r => setTimeout(r, pollIntervalMs));

        if (minimaxOAuthCancelRef.current) {
          setMinimaxOAuthPhase({ kind: 'idle' });
          return;
        }

        const tokenBody = [
          `grant_type=${encodeURIComponent(MINIMAX_OAUTH_GRANT_TYPE)}`,
          `client_id=${encodeURIComponent(MINIMAX_OAUTH_CLIENT_ID)}`,
          `user_code=${encodeURIComponent(codePayload.user_code)}`,
          `code_verifier=${encodeURIComponent(verifier)}`,
        ].join('&');

        const tokenRes = await window.electron.api.fetch({
          url: tokenEndpoint,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: tokenBody,
        });

        const tokenPayload = (tokenRes.data ?? {}) as {
          status?: string;
          access_token?: string;
          refresh_token?: string;
          expired_in?: number;
          resource_url?: string;
          notification_message?: string;
          base_resp?: { status_code?: number; status_msg?: string };
        };

        if (tokenPayload.status === 'error') {
          throw new Error(tokenPayload.base_resp?.status_msg ?? 'MiniMax OAuth error');
        }

        if (tokenPayload.status === 'success') {
          if (!tokenPayload.access_token || !tokenPayload.refresh_token) {
            throw new Error('MiniMax OAuth returned incomplete token payload');
          }

          let baseUrl = (tokenPayload.resource_url ?? '').trim();
          if (baseUrl && !baseUrl.startsWith('http')) {
            baseUrl = `https://${baseUrl}`;
          }
          if (!baseUrl) {
            baseUrl = defaultBaseUrl;
          }

          setProviders(prev => ({
            ...prev,
            minimax: {
              ...prev.minimax,
              enabled: true,
              oauthAccessToken: tokenPayload.access_token!,
              oauthBaseUrl: baseUrl,
              apiFormat: 'anthropic',
              authType: 'oauth',
              oauthRefreshToken: tokenPayload.refresh_token,
              oauthTokenExpiresAt: tokenPayload.expired_in,
              models: [...(defaultConfig.providers?.minimax.models ?? [])],
            },
          }));

          setMinimaxOAuthPhase({ kind: 'success' });
          setTimeout(() => setMinimaxOAuthPhase({ kind: 'idle' }), 1500);
          return;
        }

        // Still pending — back off gradually
        pollIntervalMs = Math.min(pollIntervalMs * 1.5, 10000);
      }

      throw new Error('MiniMax OAuth timed out waiting for authorization');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setMinimaxOAuthPhase({ kind: 'error', message });
    }
  };

  const handleCancelMiniMaxLogin = () => {
    minimaxOAuthCancelRef.current = true;
    setMinimaxOAuthPhase({ kind: 'idle' });
  };

  const handleMiniMaxOAuthLogout = () => {
    setProviders(prev => ({
      ...prev,
      minimax: {
        ...prev.minimax,
        enabled: false,
        oauthAccessToken: undefined,
        oauthBaseUrl: undefined,
        oauthRefreshToken: undefined,
        oauthTokenExpiresAt: undefined,
      },
    }));
    setMinimaxOAuthPhase({ kind: 'idle' });
  };

  // Sync the persisted ChatGPT login state into local UI state on mount and
  // whenever the OpenAI provider tab becomes active. Also reconciles stale
  // providers config (e.g. auth.json deleted externally).
  useEffect(() => {
    let cancelled = false;
    if (activeProvider !== 'openai') return;
    void window.electron.openaiCodexOAuth
      .status()
      .then(status => {
        if (cancelled) return;
        if (status.loggedIn) {
          setOpenaiOAuthStatus({ loggedIn: true, email: status.email ?? undefined });
        } else {
          setOpenaiOAuthStatus({ loggedIn: false });
          setProviders(prev => {
            if (prev.openai.authType !== 'oauth') return prev;
            return { ...prev, openai: { ...prev.openai, authType: 'apikey' } };
          });
        }
      })
      .catch(() => {
        if (!cancelled) setOpenaiOAuthStatus({ loggedIn: false });
      });
    return () => {
      cancelled = true;
    };
  }, [activeProvider]);

  const persistOpenAIProvidersConfigInBackground = useCallback((nextProviders: ProvidersConfig) => {
    void configService.updateConfig({ providers: nextProviders }).catch(saveError => {
      console.error('[Settings] failed to save OpenAI OAuth provider state:', saveError);
      setError(i18nService.t('failedToSaveSettings'));
    });
  }, []);

  const handleOpenAIOAuthLogin = async () => {
    setOpenaiOAuthPhase({ kind: 'pending' });
    try {
      const result = await window.electron.openaiCodexOAuth.start();
      if (!result.success) {
        setOpenaiOAuthPhase({ kind: 'error', message: result.error });
        return;
      }
      const nextProviders: ProvidersConfig = {
        ...providers,
        openai: {
          ...providers.openai,
          enabled: true,
          authType: 'oauth',
        },
      };
      setProviders(nextProviders);
      setOpenaiOAuthStatus({ loggedIn: true, email: result.email ?? undefined });
      setOpenaiOAuthPhase({ kind: 'success', email: result.email ?? undefined });
      persistOpenAIProvidersConfigInBackground(nextProviders);
      setTimeout(() => setOpenaiOAuthPhase({ kind: 'idle' }), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOpenaiOAuthPhase({ kind: 'error', message });
    }
  };

  const handleCancelOpenAIOAuthLogin = async () => {
    try {
      await window.electron.openaiCodexOAuth.cancel();
    } catch {
      /* ignore — we still want to reset the UI */
    }
    setOpenaiOAuthPhase({ kind: 'idle' });
  };

  const handleOpenAIOAuthLogout = async () => {
    const nextOpenAIProvider = {
      ...providers.openai,
      enabled: providers.openai.apiKey.trim().length > 0,
      authType: 'apikey' as const,
    };
    const nextProviders: ProvidersConfig = {
      ...providers,
      openai: {
        ...nextOpenAIProvider,
      },
    };
    setProviders(nextProviders);
    setOpenaiOAuthStatus({ loggedIn: false });
    setOpenaiOAuthPhase({ kind: 'idle' });
    persistOpenAIProvidersConfigInBackground(nextProviders);
    try {
      await window.electron.openaiCodexOAuth.logout();
    } catch {
      /* ignore — file may already be gone */
    }
  };

  const hasCoworkConfigChanges =
    embeddingEnabled !== (coworkConfig.embeddingEnabled ?? false) ||
    embeddingProvider !== (coworkConfig.embeddingProvider ?? 'openai') ||
    embeddingModel !== (coworkConfig.embeddingModel ?? '') ||
    embeddingLocalModelPath !== (coworkConfig.embeddingLocalModelPath ?? '') ||
    embeddingVectorWeight !== (coworkConfig.embeddingVectorWeight ?? 0.7) ||
    embeddingRemoteBaseUrl !== (coworkConfig.embeddingRemoteBaseUrl ?? '') ||
    embeddingRemoteApiKey !== (coworkConfig.embeddingRemoteApiKey ?? '');
  useEffect(() => {
    if (activeTab !== 'coworkAgent') return;
    void (async () => {
      const [identity, user, soul] = await Promise.all([
        coworkService.readBootstrapFile('IDENTITY.md'),
        coworkService.readBootstrapFile('USER.md'),
        coworkService.readBootstrapFile('SOUL.md'),
      ]);
      setBootstrapIdentity(identity);
      setBootstrapUser(user);
      setBootstrapSoul(soul);
      setBootstrapLoaded(true);
    })();
  }, [activeTab]);

  // Toggle provider enabled status
  const toggleProviderEnabled = (provider: ProviderType) => {
    const providerConfig = providers[provider];
    const currentEnabled = isProviderEnabled(provider, providerConfig);
    const isEnabling = !currentEnabled;
    const hasValidAuth = hasProviderAuthConfigured(provider, providerConfig);

    // GitHub Copilot requires device code auth — redirect to sign-in flow
    if (provider === 'github-copilot' && isEnabling && !providerConfig.apiKey.trim()) {
      handleCopilotSignIn();
      return;
    }

    if (isEnabling && !hasValidAuth) {
      setError(
        isCustomProvider(provider)
          ? i18nService.t('customProviderBaseUrlRequired')
          : i18nService.t('apiKeyRequired'),
      );
      return;
    }

    setProviders(prev => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        enabled: !currentEnabled,
        userEnabled:
          provider === ProviderName.LlamaCpp ? !currentEnabled : prev[provider].userEnabled,
      },
    }));
  };

  const enableProvider = (provider: ProviderType) => {
    setProviders(prev => {
      if (isProviderEnabled(provider, prev[provider])) {
        return prev;
      }

      return {
        ...prev,
        [provider]: {
          ...prev[provider],
          enabled: true,
          userEnabled: provider === ProviderName.LlamaCpp ? true : prev[provider].userEnabled,
        },
      };
    });
  };

  // GitHub Copilot device code authentication
  const handleCopilotSignIn = async () => {
    try {
      setCopilotAuthStatus('requesting');
      setCopilotError(null);

      // Step 1: Request device code
      const { userCode, verificationUri, deviceCode, interval, expiresIn } =
        await window.electron.githubCopilot.requestDeviceCode();

      setCopilotUserCode(userCode);
      setCopilotVerificationUri(verificationUri);
      setCopilotAuthStatus('awaiting_user');

      // Open verification URL in browser
      await window.electron.shell.openExternal(verificationUri);

      // Step 2: Poll for token
      setCopilotAuthStatus('polling');
      const result = await window.electron.githubCopilot.pollForToken(
        deviceCode,
        interval,
        expiresIn,
      );

      if (result.success && result.token) {
        setCopilotGithubUser(result.githubUser || '');
        setCopilotAuthStatus('authenticated');

        // Store the Copilot API token in the provider's apiKey field
        handleProviderConfigChange('github-copilot', 'apiKey', result.token);
        if (result.baseUrl) {
          handleProviderConfigChange('github-copilot', 'baseUrl', result.baseUrl);
        }
        // Auto-enable the provider
        enableProvider('github-copilot');
      } else {
        setCopilotError(result.error || 'Authentication failed');
        setCopilotAuthStatus('error');
      }
    } catch (error: unknown) {
      setCopilotError(error instanceof Error ? error.message : 'Authentication failed');
      setCopilotAuthStatus('error');
    }
  };

  const handleCopilotSignOut = async () => {
    try {
      await window.electron.githubCopilot.signOut();
      setCopilotAuthStatus('idle');
      setCopilotGithubUser('');
      setCopilotUserCode('');
      setCopilotError(null);
      // Clear the token from provider config
      handleProviderConfigChange('github-copilot', 'apiKey', '');
      // Disable the provider
      setProviders(prev => ({
        ...prev,
        'github-copilot': { ...prev['github-copilot'], enabled: false },
      }));
    } catch (error) {
      console.error('[Settings] GitHub Copilot sign-out failed:', error);
    }
  };

  const handleCopilotCancelAuth = async () => {
    try {
      await window.electron.githubCopilot.cancelPolling();
      setCopilotAuthStatus('idle');
      setCopilotUserCode('');
      setCopilotError(null);
    } catch (error) {
      console.error('[Settings] GitHub Copilot cancel polling failed:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    let appConfigSaved = false;

    try {
      const emailSaved = (await emailSettingsRef.current?.saveIfDirty()) ?? true;
      if (!emailSaved) {
        setActiveTab('email');
        return;
      }

      const normalizedProviders = Object.fromEntries(
        Object.entries(providers).map(([providerKey, providerConfig]) => {
          const apiFormat = getEffectiveApiFormat(providerKey, providerConfig.apiFormat);
          const hasValidAuth = hasProviderAuthConfigured(
            providerKey as ProviderType,
            providerConfig,
          );
          const normalizedEnabled =
            providerKey === ProviderName.LlamaCpp
              ? providerConfig.userEnabled === true
              : providerConfig.enabled && hasValidAuth;
          return [
            providerKey,
            {
              ...providerConfig,
              enabled: normalizedEnabled,
              userEnabled:
                providerKey === ProviderName.LlamaCpp
                  ? normalizedEnabled
                  : providerConfig.userEnabled,
              apiFormat,
              baseUrl: resolveBaseUrl(
                providerKey as ProviderType,
                providerConfig.baseUrl,
                apiFormat,
              ),
            },
          ];
        }),
      ) as ProvidersConfig;

      // Prefer a remote enabled provider for the app-wide fallback API, then
      // fall back to any enabled local provider such as llama.cpp.
      const firstEnabledProvider =
        Object.entries(normalizedProviders).find(
          ([providerKey, config]) =>
            providerKey !== ProviderName.LlamaCpp && isProviderEnabled(providerKey, config),
        ) ??
        Object.entries(normalizedProviders).find(([providerKey, config]) =>
          isProviderEnabled(providerKey, config),
        );

      const primaryProvider = firstEnabledProvider
        ? firstEnabledProvider[1]
        : normalizedProviders[activeProvider];

      const currentAppConfig = configService.getConfig();
      const appConfigPatch = buildAppSettingsSavePatch({
        current: currentAppConfig,
        theme,
        language,
        useSystemProxy,
        sqliteAutoBackupEnabled,
        shortcuts,
        providers: normalizedProviders,
        api: {
          key: primaryProvider.apiKey,
          baseUrl: primaryProvider.baseUrl,
        },
        model: reconcileDefaultModelConfig(currentAppConfig, normalizedProviders),
      });
      if (Object.keys(appConfigPatch).length > 0) {
        await configService.updateConfig(appConfigPatch);
        appConfigSaved = true;
      }

      // 应用主题
      themeService.setTheme(theme);

      // 应用语言
      i18nService.setLanguage(language, { persist: false });

      // Set API with the primary provider - handle Qwen OAuth
      let apiKeyToUse = primaryProvider.apiKey;
      let baseUrlToUse = primaryProvider.baseUrl;

      apiService.setConfig({
        apiKey: apiKeyToUse,
        baseUrl: baseUrlToUse,
      });

      if (hasCoworkConfigChanges) {
        const updated = await coworkService.updateConfig({
          embeddingEnabled,
          embeddingProvider,
          embeddingModel,
          embeddingLocalModelPath,
          embeddingVectorWeight,
          embeddingRemoteBaseUrl,
          embeddingRemoteApiKey,
        });
        if (!updated) {
          throw new Error(i18nService.t('coworkConfigSaveFailed'));
        }
      }

      // Save bootstrap files (IDENTITY.md, USER.md, SOUL.md) only if loaded.
      if (bootstrapLoaded) {
        const results = await Promise.all([
          coworkService.writeBootstrapFile('IDENTITY.md', bootstrapIdentity),
          coworkService.writeBootstrapFile('USER.md', bootstrapUser),
          coworkService.writeBootstrapFile('SOUL.md', bootstrapSoul),
        ]);
        if (results.some(r => !r)) {
          throw new Error(i18nService.t('coworkBootstrapSaveFailed'));
        }
      }

      const channelConfigSynced = await imService.syncPendingConfig();
      if (!channelConfigSynced) {
        throw new Error(i18nService.t('coworkConfigSaveFailed'));
      }

      didSaveRef.current = true;
      onClose();
    } catch (error) {
      setError(getSettingsSaveErrorMessage(error, appConfigSaved, key => i18nService.t(key)));
    } finally {
      setIsSaving(false);
    }
  };

  // 标签页切换处理
  const handleTabChange = (tab: SettingsTabType) => {
    if (tab !== 'model') {
      setIsAddingModel(false);
      setIsEditingModel(false);
      setEditingModelId(null);
      setNewModelName('');
      setNewModelId('');
      setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
      setModelFormError(null);
    }
    setActiveTab(tab);
  };

  // Mapping from shortcut key to i18n label key for conflict messages
  const shortcutLabelMap: Record<string, string> = {
    newChat: 'newChat',
    search: 'search',
    settings: 'openSettings',
    sendMessage: 'sendMessageShortcut',
  };

  // 快捷键更新处理
  const handleShortcutChange = (key: keyof typeof shortcuts, value: string) => {
    // Check for conflicts with other shortcuts (skip unset values)
    const conflictKey =
      value &&
      Object.keys(shortcuts).find(
        k =>
          k !== key &&
          shortcuts[k as keyof typeof shortcuts] &&
          shortcuts[k as keyof typeof shortcuts] === value,
      );
    if (conflictKey) {
      const conflictLabel = i18nService.t(shortcutLabelMap[conflictKey] ?? conflictKey);
      setNoticeMessage(
        i18nService.t('shortcutConflict').replace('{0}', value).replace('{1}', conflictLabel),
      );
      return;
    }
    setShortcuts(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  // 阻止点击设置窗口时事件传播到背景
  const handleSettingsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleSettingsFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) {
      return;
    }
    event.preventDefault();
  };

  // Handlers for model operations
  const handleAddModel = () => {
    setIsAddingModel(true);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
    setNewModelPiRuntime(undefined);
    setModelFormError(null);
  };

  const handleEditModel = (
    modelId: string,
    modelName: string,
    supportsImage?: boolean,
    capabilities?: Partial<ModelCapabilities>,
    piRuntime?: ProviderModelPiRuntimeConfig,
    contextWindow?: number,
    maxTokens?: number,
  ) => {
    setIsAddingModel(false);
    setIsEditingModel(true);
    setEditingModelId(modelId);
    setNewModelName(modelName);
    setNewModelId(modelId);
    setNewModelContextWindow(formatTokenK(contextWindow));
    setNewModelMaxTokens(formatTokenK(maxTokens));
    setNewModelCapabilities({
      ...DEFAULT_CUSTOM_MODEL_CAPABILITIES,
      ...capabilities,
      imageInput:
        capabilities?.imageInput ??
        (supportsImage ? ModelCapabilityStatus.Supported : ModelCapabilityStatus.Unsupported),
    });
    setNewModelPiRuntime(piRuntime);
    setModelFormError(null);
  };

  const handleDeleteModel = (modelId: string) => {
    if (!providers[activeProvider].models) return;
    const model = providers[activeProvider].models.find(item => item.id === modelId);
    if (!model) return;
    setPendingDeleteModel({ id: modelId, name: model.name });
  };

  const confirmDeleteModel = () => {
    if (!pendingDeleteModel || !providers[activeProvider].models) return;
    const modelId = pendingDeleteModel.id;

    const updatedModels = providers[activeProvider].models.filter(model => model.id !== modelId);

    setProviders(prev => ({
      ...prev,
      [activeProvider]: {
        ...prev[activeProvider],
        models: updatedModels,
      },
    }));
    setPendingDeleteModel(null);
  };

  const handleSaveNewModel = async (): Promise<void> => {
    const modelId = newModelId.trim();

    if (activeProvider === 'ollama') {
      // For Ollama, only the model name (stored as modelId) is required.
      if (!modelId) {
        setModelFormError(i18nService.t('ollamaModelNameRequired'));
        return;
      }
    } else {
      const modelName = newModelName.trim();
      if (!modelName || !modelId) {
        setModelFormError(i18nService.t('modelNameAndIdRequired'));
        return;
      }
    }

    // For Ollama, auto-fill display name from modelId if not provided
    const modelName =
      activeProvider === 'ollama'
        ? newModelName.trim() && newModelName.trim() !== modelId
          ? newModelName.trim()
          : modelId
        : newModelName.trim();

    const contextWindow = parseTokenK(newModelContextWindow);
    const maxTokens = parseTokenK(newModelMaxTokens);
    if (
      (newModelContextWindow.trim() && contextWindow === undefined) ||
      (newModelMaxTokens.trim() && maxTokens === undefined)
    ) {
      setModelFormError(i18nService.t('modelContextWindowInvalid'));
      return;
    }

    if (activeProvider === ProviderName.LlamaCpp) {
      await window.electron.llamacpp.setModelPreference({
        modelName: modelId,
        preference: {
          ...(contextWindow ? { ctxSize: contextWindow } : {}),
          ...(maxTokens ? { maxTokens } : {}),
          capabilities: newModelCapabilities,
        },
      });
      window.dispatchEvent(new CustomEvent(LLAMACPP_RUNNING_MODELS_CHANGED_EVENT));
      handleCancelModelEdit();
      return;
    }

    const currentModels = providers[activeProvider].models ?? [];
    const duplicateModel = currentModels.find(
      model => model.id === modelId && (!isEditingModel || model.id !== editingModelId),
    );
    if (duplicateModel) {
      setModelFormError(i18nService.t('modelIdExists'));
      return;
    }

    const nextModel = {
      id: modelId,
      name: modelName,
      supportsImage: ProviderRegistry.resolveModelSupportsImage(
        activeProvider,
        modelId,
        newModelCapabilities.imageInput === ModelCapabilityStatus.Supported,
      ),
      ...(contextWindow ? { contextWindow } : {}),
      ...(maxTokens ? { maxTokens } : {}),
      ...(isCustomProvider(activeProvider) || activeProvider === ProviderName.Ollama
        ? { capabilities: newModelCapabilities }
        : {}),
      ...(isCustomProvider(activeProvider) && newModelPiRuntime
        ? { piRuntime: newModelPiRuntime }
        : {}),
    };
    const updatedModels =
      isEditingModel && editingModelId
        ? currentModels.map(model => (model.id === editingModelId ? nextModel : model))
        : [...currentModels, nextModel];

    setProviders(prev => ({
      ...prev,
      [activeProvider]: {
        ...prev[activeProvider],
        models: updatedModels,
      },
    }));

    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelContextWindow('');
    setNewModelMaxTokens('');
    setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
    setNewModelPiRuntime(undefined);
    setModelFormError(null);
  };

  const handleCancelModelEdit = () => {
    setIsAddingModel(false);
    setIsEditingModel(false);
    setEditingModelId(null);
    setNewModelName('');
    setNewModelId('');
    setNewModelContextWindow('');
    setNewModelMaxTokens('');
    setNewModelCapabilities(DEFAULT_CUSTOM_MODEL_CAPABILITIES);
    setNewModelPiRuntime(undefined);
    setModelFormError(null);
  };

  const showConnectionTestNotification = (
    result: { success: boolean; message: string },
    provider: ProviderType,
    model?: Pick<NonNullable<ProviderConfig['models']>[number], 'id' | 'name'>,
  ) => {
    const providerLabel = ProviderRegistry.get(provider)?.label ?? provider;
    const modelName = model?.name.trim();
    const modelId = model?.id;
    const modelLabel =
      modelName && modelId && modelName !== modelId ? `${modelName} (${modelId})` : modelId;
    const subject = modelLabel ?? providerLabel;
    const message = result.success
      ? `${subject}: ${i18nService.t('connectionSuccess')}`
      : `${subject}: ${result.message}`;
    window.dispatchEvent(
      new CustomEvent('app:showToast', {
        detail: {
          message,
          isError: !result.success,
          isSuccess: result.success,
          autoClose: true,
          durationMs: result.success ? undefined : 5_000,
        },
      }),
    );
  };

  const persistTestedProviderConfiguration = async (
    provider: ProviderType,
    providerConfig: ProviderConfig,
  ): Promise<void> => {
    if (provider === ProviderName.LlamaCpp) return;

    const apiFormat = getEffectiveApiFormat(provider, providerConfig.apiFormat);
    const currentConfig = configService.getConfig();
    const nextProviders = {
      ...(currentConfig.providers ?? {}),
      [provider]: {
        ...providerConfig,
        enabled: true,
        apiFormat,
        baseUrl: resolveBaseUrl(provider, providerConfig.baseUrl, apiFormat),
      },
    } as ProvidersConfig;
    await configService.updateConfig({ providers: nextProviders });
  };

  const completeSuccessfulConnectionTest = async (
    provider: ProviderType,
    providerConfig: ProviderConfig,
    model: Pick<NonNullable<ProviderConfig['models']>[number], 'id' | 'name'>,
  ): Promise<void> => {
    try {
      await persistTestedProviderConfiguration(provider, providerConfig);
      if (provider !== ProviderName.LlamaCpp) {
        enableProvider(provider);
      }
      showConnectionTestNotification(
        { success: true, message: i18nService.t('connectionSuccess') },
        provider,
        model,
      );
    } catch (error) {
      console.error('[Settings] failed to save tested provider configuration:', error);
        showConnectionTestNotification(
          { success: false, message: i18nService.t('failedToSaveSettings') },
          provider,
          model,
        );
    }
  };

  // 测试 API 连接
  const handleTestConnection = async (requestedModelId?: string) => {
    const testingProvider = activeProvider;
    const providerConfig = providers[testingProvider];
    const hasValidAuth = providerConfig.apiKey;

    if (providerRequiresApiKey(testingProvider) && !hasValidAuth) {
      showConnectionTestNotification(
        { success: false, message: i18nService.t('apiKeyRequired') },
        testingProvider,
      );
      return;
    }

    const selectedModel = providerConfig.models?.find(
      model => model.id === (requestedModelId ?? selectedModelId),
    );
    let firstModel = selectedModel
      ? { ...selectedModel }
      : providerConfig.models?.[0]
        ? { ...providerConfig.models[0] }
        : undefined;

    if (testingProvider === ProviderName.LlamaCpp) {
      const runningModels = await window.electron.llamacpp.listRunningModels().catch(() => []);
      const runningModelNames = runningModels
        .map(model => model.name?.trim() || model.model?.trim() || model.id?.trim() || '')
        .filter(Boolean);
      if (runningModelNames.length === 0) {
        showConnectionTestNotification(
          {
            success: false,
            message: i18nService.t('agentLlamaCppModelNotRunningBlocked'),
          },
          testingProvider,
        );
        return;
      }
      const matchedConfiguredModel = (providerConfig.models ?? []).find(
        model => runningModelNames.includes(model.id) || runningModelNames.includes(model.name),
      );
      firstModel = matchedConfiguredModel
        ? { ...matchedConfiguredModel }
        : {
            id: runningModelNames[0],
            name: runningModelNames[0],
            supportsImage: false,
          };
    }

    if (!firstModel) {
      showConnectionTestNotification(
        { success: false, message: i18nService.t('noModelsConfigured') },
        testingProvider,
      );
      return;
    }

    if (testingProvider === 'qwen' && (firstModel.id === 'vision-model' || firstModel.id === 'coder-model')) {
      const defaultQwenModel = defaultConfig.providers?.qwen?.models?.[0];
      firstModel.id = defaultQwenModel?.id || 'qwen3.5-plus';
    }

    const requestId = (modelConnectionTestRequestIdRef.current[testingProvider] ?? 0) + 1;
    modelConnectionTestRequestIdRef.current[testingProvider] = requestId;
    const result = await testProviderModelConnection({
      providerId: testingProvider,
      provider: providerConfig,
      baseUrl: resolveBaseUrl(
        testingProvider,
        providerConfig.baseUrl,
        getEffectiveApiFormat(testingProvider, providerConfig.apiFormat),
      ),
      apiFormat: getEffectiveApiFormat(testingProvider, providerConfig.apiFormat),
      model: firstModel,
    });
    if (modelConnectionTestRequestIdRef.current[testingProvider] !== requestId) return;

    setModelConnectionStatus(
      testingProvider,
      firstModel.id,
      result.success ? ModelConnectionStatus.Success : ModelConnectionStatus.Failure,
    );
    if (result.success) {
      await completeSuccessfulConnectionTest(testingProvider, providerConfig, firstModel);
    } else {
      showConnectionTestNotification({ success: false, message: result.message }, testingProvider, firstModel);
    }
  };

  const handleModelsDiscovered = async (
    providerId: string,
    discoveredModels: readonly DiscoveredProviderModel[],
  ) => {
      const provider = providerId as ProviderType;
      const providerConfig = providers[provider];
      const merged = mergeDiscoveredProviderModels(providerConfig.models ?? [], discoveredModels);
      const nextProviderConfig: ProviderConfig = {
        ...providerConfig,
        models: merged.models,
      };
      const modelsToTest = merged.models.map(model => ({
        id: model.id,
        name: model.name,
      }));
      if (modelsToTest.length === 0) return false;
      const requestId = (modelConnectionTestRequestIdRef.current[provider] ?? 0) + 1;
      modelConnectionTestRequestIdRef.current[provider] = requestId;

      if (provider === activeProvider && discoveredModels.length > 0) {
        setSelectedModelId(current => current || discoveredModels[0].id);
      }
      setProviders(current => ({
        ...current,
        [provider]: {
          ...current[provider],
          models: mergeDiscoveredProviderModels(current[provider].models ?? [], discoveredModels).models,
        },
      }));

      const results = await testProviderModelsSequentially({
        providerId: provider,
        provider: nextProviderConfig,
        baseUrl: resolveBaseUrl(
          provider,
          nextProviderConfig.baseUrl,
          getEffectiveApiFormat(provider, nextProviderConfig.apiFormat),
        ),
        apiFormat: getEffectiveApiFormat(provider, nextProviderConfig.apiFormat),
        models: modelsToTest,
      });
      if (modelConnectionTestRequestIdRef.current[provider] !== requestId) return true;

      const statuses = Object.fromEntries(
        results.map(({ model, result }) => [
          model.id,
          result.success ? ModelConnectionStatus.Success : ModelConnectionStatus.Failure,
        ]),
      );
      setProviderModelConnectionStatuses(provider, statuses);

      const successCount = results.filter(({ result }) => result.success).length;
      const failureCount = results.length - successCount;
      if (successCount > 0) {
        try {
          await persistTestedProviderConfiguration(provider, nextProviderConfig);
          if (provider !== ProviderName.LlamaCpp) enableProvider(provider);
        } catch (error) {
          console.error('[Settings] failed to save auto-tested provider configuration:', error);
          showConnectionTestNotification(
            { success: false, message: i18nService.t('failedToSaveSettings') },
            provider,
          );
          return true;
        }
      }

      const summary = i18nService
        .t(failureCount === 0 ? 'modelConnectionTestSuccessSummary' : 'modelConnectionTestSummary')
        .replace('{total}', String(results.length))
        .replace('{success}', String(successCount))
        .replace('{failure}', String(failureCount));
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: {
            message: summary,
            isError: failureCount > 0,
            isSuccess: failureCount === 0,
            autoClose: true,
            durationMs: failureCount > 0 ? 5_000 : undefined,
          },
        }),
      );
      return true;
  };

  const buildProvidersExport = async (password: string): Promise<ProvidersExportPayload> => {
    // Only export providers that have an API key configured, regardless of enabled state.
    // Skip preset providers that were never configured to avoid exporting default models.
    const configuredEntries = Object.entries(providers).filter(([providerKey, cfg]) => {
      const providerConfig = cfg as ProviderConfig;
      return isCustomProvider(providerKey)
        ? Boolean(providerConfig.baseUrl?.trim() || providerConfig.apiKey?.trim())
        : Boolean(providerConfig.apiKey?.trim());
    });
    const entries = await Promise.all(
      configuredEntries.map(async ([providerKey, providerConfig]) => {
        const apiKey = await encryptWithPassword(providerConfig.apiKey, password);
        const apiFormat = getEffectiveApiFormat(providerKey, providerConfig.apiFormat);
        return [
          providerKey,
          {
            enabled: providerConfig.enabled,
            userEnabled: providerConfig.userEnabled,
            apiKey,
            baseUrl: resolveBaseUrl(providerKey as ProviderType, providerConfig.baseUrl, apiFormat),
            apiFormat,
            codingPlanEnabled: (providerConfig as ProviderConfig).codingPlanEnabled,
            models: normalizeModels(providerKey, providerConfig.models),
          },
        ] as const;
      }),
    );

    return {
      type: EXPORT_FORMAT_TYPE,
      version: 2,
      exportedAt: new Date().toISOString(),
      encryption: {
        algorithm: 'AES-GCM',
        keySource: 'password',
        keyDerivation: 'PBKDF2',
      },
      providers: Object.fromEntries(entries),
    };
  };

  const normalizeModels = (providerKey: string, models?: Model[]) =>
    models?.map(model => ({
      ...model,
      supportsImage: resolveModelSupportsImageForProvider(providerKey, model),
    }));

  const DEFAULT_EXPORT_PASSWORD = EXPORT_PASSWORD;

  const handleExportProviders = async () => {
    setError(null);
    setIsExportingProviders(true);

    try {
      const payload = await buildProvidersExport(DEFAULT_EXPORT_PASSWORD);
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${APP_ID}-providers-${date}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      console.error('Failed to export providers:', err);
      setError(i18nService.t('exportProvidersFailed'));
    } finally {
      setIsExportingProviders(false);
    }
  };

  const handleImportProvidersClick = () => {
    importInputRef.current?.click();
  };

  const handleImportProviders = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setError(null);

    try {
      const raw = await file.text();
      console.log(`[Settings] importing providers from file: ${file.name}, size: ${file.size}`);
      let payload: ProvidersImportPayload;
      try {
        payload = JSON.parse(raw) as ProvidersImportPayload;
      } catch {
        console.warn('[Settings] import failed: invalid JSON in file');
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      if (!payload || payload.type !== EXPORT_FORMAT_TYPE || !payload.providers) {
        console.warn(
          `[Settings] import failed: invalid format, type=${payload?.type}, hasProviders=${!!payload?.providers}`,
        );
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      // Check if it's version 2 (password-based encryption)
      if (payload.version === 2 && payload.encryption?.keySource === 'password') {
        console.log('[Settings] import: detected v2 password-based encryption');
        await processImportPayloadWithPassword(payload);
        return;
      }

      // Version 1 (legacy local-store key) - try to decrypt with local key
      if (payload.version === 1) {
        console.log('[Settings] import: detected v1 local-key encryption');
        await processImportPayloadWithLocalKey(payload);
        return;
      }

      console.warn(`[Settings] import failed: unsupported version=${payload.version}`);
      setError(i18nService.t('invalidProvidersFile'));
    } catch (err) {
      console.error('[Settings] import failed:', err);
      setError(i18nService.t('importProvidersFailed'));
    }
  };

  const processImportPayloadWithLocalKey = async (payload: ProvidersImportPayload) => {
    setIsImportingProviders(true);
    try {
      const fileKeys = Object.keys(payload.providers ?? {});
      console.log(`[Settings] v1 import: processing ${fileKeys.length} providers from file`);
      const providerUpdates: Partial<ProvidersConfig> = {};
      let hadDecryptFailure = false;
      for (const providerKey of providerKeys) {
        const providerData = payload.providers?.[providerKey];
        if (!providerData) {
          continue;
        }

        let apiKey: string | undefined;
        if (typeof providerData.apiKey === 'string') {
          apiKey = providerData.apiKey;
        } else if (providerData.apiKey && typeof providerData.apiKey === 'object') {
          try {
            apiKey = await decryptSecret(providerData.apiKey as EncryptedPayload);
            console.log(`[Settings] v1 import: decrypted key for ${providerKey}`);
          } catch (error) {
            hadDecryptFailure = true;
            console.warn(`[Settings] v1 import: failed to decrypt key for ${providerKey}`, error);
          }
        } else if (
          typeof providerData.apiKeyEncrypted === 'string' &&
          typeof providerData.apiKeyIv === 'string'
        ) {
          try {
            apiKey = await decryptSecret({
              encrypted: providerData.apiKeyEncrypted,
              iv: providerData.apiKeyIv,
            });
            console.log(`[Settings] v1 import: decrypted key for ${providerKey}`);
          } catch (error) {
            hadDecryptFailure = true;
            console.warn(`[Settings] v1 import: failed to decrypt key for ${providerKey}`, error);
          }
        }

        const models = normalizeModels(providerKey, providerData.models);
        const existing = providers[providerKey];

        providerUpdates[providerKey] = {
          enabled:
            typeof providerData.enabled === 'boolean'
              ? providerData.enabled
              : (existing?.enabled ?? false),
          userEnabled:
            typeof providerData.userEnabled === 'boolean'
              ? providerData.userEnabled
              : providerKey === ProviderName.LlamaCpp
                ? typeof providerData.enabled === 'boolean'
                  ? providerData.enabled
                  : (existing?.userEnabled ?? false)
                : existing?.userEnabled,
          apiKey: apiKey ?? existing?.apiKey ?? '',
          baseUrl:
            typeof providerData.baseUrl === 'string'
              ? providerData.baseUrl
              : (existing?.baseUrl ?? ''),
          apiFormat: getEffectiveApiFormat(
            providerKey,
            providerData.apiFormat ?? existing?.apiFormat,
          ),
          codingPlanEnabled:
            typeof providerData.codingPlanEnabled === 'boolean'
              ? providerData.codingPlanEnabled
              : (existing as ProviderConfig)?.codingPlanEnabled,
          models: models ?? existing?.models,
        };
      }

      if (Object.keys(providerUpdates).length === 0) {
        console.warn(
          `[Settings] v1 import failed: no matching providers found, file keys: ${fileKeys.join(', ')}`,
        );
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      setProviders(prev => {
        const next = { ...prev };
        Object.entries(providerUpdates).forEach(([providerKey, update]) => {
          next[providerKey] = {
            ...prev[providerKey],
            ...update,
          };
        });
        return next;
      });
      console.log(
        `[Settings] v1 import complete: updated ${Object.keys(providerUpdates).length} providers`,
      );
      if (hadDecryptFailure) {
        setNoticeMessage(i18nService.t('decryptProvidersPartial'));
      }
    } catch (err) {
      console.error('[Settings] v1 import failed:', err);
      const isDecryptError =
        err instanceof Error &&
        (err.message === 'Invalid encrypted payload' || err.name === 'OperationError');
      const message = isDecryptError
        ? i18nService.t('decryptProvidersFailed')
        : i18nService.t('importProvidersFailed');
      setError(message);
    } finally {
      setIsImportingProviders(false);
    }
  };

  const processImportPayloadWithPassword = async (payload: ProvidersImportPayload) => {
    if (!payload.providers) {
      return;
    }

    setIsImportingProviders(true);

    try {
      const fileKeys = Object.keys(payload.providers);
      console.log(`[Settings] v2 import: processing ${fileKeys.length} providers from file`);
      const providerUpdates: Partial<ProvidersConfig> = {};
      let hadDecryptFailure = false;

      for (const providerKey of providerKeys) {
        const providerData = payload.providers[providerKey];
        if (!providerData) {
          continue;
        }

        let apiKey: string | undefined;
        if (typeof providerData.apiKey === 'string') {
          apiKey = providerData.apiKey;
        } else if (providerData.apiKey && typeof providerData.apiKey === 'object') {
          const apiKeyObj = providerData.apiKey as PasswordEncryptedPayload;
          if (apiKeyObj.salt) {
            // Version 2 password-based encryption
            try {
              apiKey = await decryptWithPassword(apiKeyObj, DEFAULT_EXPORT_PASSWORD);
              console.log(`[Settings] v2 import: decrypted key for ${providerKey}`);
            } catch (error) {
              hadDecryptFailure = true;
              console.warn(`[Settings] v2 import: failed to decrypt key for ${providerKey}`, error);
            }
          }
        }

        const models = normalizeModels(providerKey, providerData.models);
        const existing = providers[providerKey];

        providerUpdates[providerKey] = {
          enabled:
            typeof providerData.enabled === 'boolean'
              ? providerData.enabled
              : (existing?.enabled ?? false),
          userEnabled:
            typeof providerData.userEnabled === 'boolean'
              ? providerData.userEnabled
              : providerKey === ProviderName.LlamaCpp
                ? typeof providerData.enabled === 'boolean'
                  ? providerData.enabled
                  : (existing?.userEnabled ?? false)
                : existing?.userEnabled,
          apiKey: apiKey ?? existing?.apiKey ?? '',
          baseUrl:
            typeof providerData.baseUrl === 'string'
              ? providerData.baseUrl
              : (existing?.baseUrl ?? ''),
          apiFormat: getEffectiveApiFormat(
            providerKey,
            providerData.apiFormat ?? existing?.apiFormat,
          ),
          codingPlanEnabled:
            typeof providerData.codingPlanEnabled === 'boolean'
              ? providerData.codingPlanEnabled
              : (existing as ProviderConfig)?.codingPlanEnabled,
          models: models ?? existing?.models,
        };
      }

      if (Object.keys(providerUpdates).length === 0) {
        console.warn(
          `[Settings] v2 import failed: no matching providers found, file keys: ${fileKeys.join(', ')}`,
        );
        setError(i18nService.t('invalidProvidersFile'));
        return;
      }

      // Check if any key was successfully decrypted
      const anyKeyDecrypted = Object.entries(providerUpdates).some(
        ([key, update]) => update?.apiKey && update.apiKey !== providers[key]?.apiKey,
      );

      if (!anyKeyDecrypted && hadDecryptFailure) {
        // All decryptions failed - likely wrong password
        console.warn(
          '[Settings] v2 import failed: all key decryptions failed, likely wrong password',
        );
        setError(i18nService.t('decryptProvidersFailed'));
        return;
      }

      setProviders(prev => {
        const next = { ...prev };
        Object.entries(providerUpdates).forEach(([providerKey, update]) => {
          next[providerKey] = {
            ...prev[providerKey],
            ...update,
          };
        });
        return next;
      });
      console.log(
        `[Settings] v2 import complete: updated ${Object.keys(providerUpdates).length} providers`,
      );
      if (hadDecryptFailure) {
        setNoticeMessage(i18nService.t('decryptProvidersPartial'));
      }
    } catch (err) {
      console.error('[Settings] v2 import failed:', err);
      const isDecryptError =
        err instanceof Error &&
        (err.message === 'Invalid encrypted payload' || err.name === 'OperationError');
      const message = isDecryptError
        ? i18nService.t('decryptProvidersFailed')
        : i18nService.t('importProvidersFailed');
      setError(message);
    } finally {
      setIsImportingProviders(false);
    }
  };

  // 渲染标签页
  const sidebarTabs: { key: SettingsTabType; label: string; icon: React.ReactNode }[] = (() => {
    const allTabs: { key: SettingsTabType; label: string; icon: React.ReactNode }[] = [
      {
        key: 'general' as TabType,
        label: i18nService.t('general'),
        icon: <SettingsAnimatedSlidersHorizontalIcon ref={generalIconRef} />,
      },
      {
        key: 'appearance' as TabType,
        label: i18nService.t('appearance'),
        icon: <SettingsAnimatedSunMediumIcon ref={appearanceIconRef} />,
      },
      {
        key: 'model' as TabType,
        label: i18nService.t('model'),
        icon: <SettingsAnimatedBoxIcon ref={modelIconRef} />,
      },
      {
        key: 'im' as TabType,
        label: i18nService.t('imBot'),
        icon: <SettingsAnimatedMessageCircleMoreIcon ref={imIconRef} />,
      },
      {
        key: 'email' as TabType,
        label: i18nService.t('emailTab'),
        icon: <SettingsAnimatedMailCheckIcon ref={emailIconRef} />,
      },
      {
        key: 'coworkMemory' as TabType,
        label: i18nService.t('coworkMemoryTitle'),
        icon: <SettingsAnimatedBrainIcon ref={memoryIconRef} />,
      },
      {
        key: 'shortcuts' as TabType,
        label: i18nService.t('shortcuts'),
        icon: <SettingsAnimatedKeyboardIcon ref={shortcutsIconRef} />,
      },
      {
        key: 'about' as TabType,
        label: i18nService.t('about'),
        icon: <SettingsAnimatedCircleHelpIcon ref={aboutIconRef} />,
      },
    ];
    if (enterpriseSettingsPages.length > 0) {
      allTabs.splice(
        allTabs.length - 1,
        0,
        ...enterpriseSettingsPages.map(page => ({
          key: toEnterpriseTab(page.id),
          label: page.labels[language],
          icon:
            page.id === 'models' ? (
              <ServerCog aria-hidden="true" />
            ) : (
              <Building2 aria-hidden="true" />
            ),
        })),
      );
    }
    // Filter out tabs hidden by enterprise config
    // Filter out tabs with 'hide' action in enterprise config
    // e.g., ui: { "settings.im": "hide" } → hide the 'im' tab
    const ui = enterpriseConfig?.ui;
    const configuredTabs = ui
      ? allTabs.filter(tab => ui[`settings.${tab.key}`] !== 'hide')
      : allTabs;
    return filterManagedModelSettingsTabs(configuredTabs, managedModelsOnly);
  })();

  const activeTabLabel = useMemo(() => {
    return sidebarTabs.find(t => t.key === activeTab)?.label ?? '';
  }, [activeTab, sidebarTabs]);

  const renderAppearanceSettings = () => (
    <div className="space-y-8">
      <div>
        <h4 className="text-sm font-medium mb-3" style={{ color: 'var(--zy-text-primary)' }}>
          {i18nService.t('appearance')}
        </h4>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {(['light', 'dark', 'system'] as const).map(mode => {
            const isSelected = theme === mode;
            return (
              <Button
                key={mode}
                type="button"
                variant="outline"
                size="lg"
                aria-pressed={isSelected}
                onClick={() => {
                  setTheme(mode);
                  themeService.setTheme(mode);
                }}
                className="h-auto w-full flex-col items-center rounded-lg border p-3"
                style={{
                  borderColor: isSelected ? 'var(--zy-primary)' : 'var(--zy-border)',
                  backgroundColor: isSelected ? 'var(--zy-primary-muted)' : 'transparent',
                }}
              >
                <span className="mb-2 block aspect-[3/2] w-full overflow-hidden rounded-md">
                  <svg
                    viewBox="0 0 120 80"
                    className="size-full"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    {mode === 'light' && (
                      <>
                        <rect width="120" height="80" fill="#ffffff" />
                        <rect x="0" y="0" width="30" height="80" fill="#f4f4f5" />
                        <rect x="4" y="8" width="22" height="4" rx="2" fill="#a1a1aa" />
                        <rect x="4" y="16" width="18" height="3" rx="1.5" fill="#d4d4d8" />
                        <rect x="4" y="22" width="20" height="3" rx="1.5" fill="#d4d4d8" />
                        <rect x="4" y="28" width="16" height="3" rx="1.5" fill="#d4d4d8" />
                        <rect x="36" y="8" width="78" height="64" rx="4" fill="#ffffff" />
                        <rect x="42" y="16" width="50" height="4" rx="2" fill="#d4d4d8" />
                        <rect x="42" y="24" width="66" height="3" rx="1.5" fill="#e5e5e5" />
                        <rect x="42" y="30" width="60" height="3" rx="1.5" fill="#e5e5e5" />
                        <rect x="42" y="36" width="55" height="3" rx="1.5" fill="#e5e5e5" />
                        <rect x="42" y="46" width="40" height="4" rx="2" fill="#d4d4d8" />
                        <rect x="42" y="54" width="66" height="3" rx="1.5" fill="#e5e5e5" />
                        <rect x="42" y="60" width="58" height="3" rx="1.5" fill="#e5e5e5" />
                      </>
                    )}
                    {mode === 'dark' && (
                      <>
                        <rect width="120" height="80" fill="#1a1d23" />
                        <rect x="0" y="0" width="30" height="80" fill="#2d2d2d" />
                        <rect x="4" y="8" width="22" height="4" rx="2" fill="#52525b" />
                        <rect x="4" y="16" width="18" height="3" rx="1.5" fill="#3f3f46" />
                        <rect x="4" y="22" width="20" height="3" rx="1.5" fill="#3f3f46" />
                        <rect x="4" y="28" width="16" height="3" rx="1.5" fill="#3f3f46" />
                        <rect x="36" y="8" width="78" height="64" rx="4" fill="#2d2d2d" />
                        <rect x="42" y="16" width="50" height="4" rx="2" fill="#52525b" />
                        <rect x="42" y="24" width="66" height="3" rx="1.5" fill="#3f3f46" />
                        <rect x="42" y="30" width="60" height="3" rx="1.5" fill="#3f3f46" />
                        <rect x="42" y="36" width="55" height="3" rx="1.5" fill="#3f3f46" />
                        <rect x="42" y="46" width="40" height="4" rx="2" fill="#52525b" />
                        <rect x="42" y="54" width="66" height="3" rx="1.5" fill="#3f3f46" />
                        <rect x="42" y="60" width="58" height="3" rx="1.5" fill="#3f3f46" />
                      </>
                    )}
                    {mode === 'system' && (
                      <>
                        <defs>
                          <clipPath id="left-half">
                            <rect x="0" y="0" width="60" height="80" />
                          </clipPath>
                          <clipPath id="right-half">
                            <rect x="60" y="0" width="60" height="80" />
                          </clipPath>
                        </defs>
                        <g clipPath="url(#left-half)">
                          <rect width="120" height="80" fill="#ffffff" />
                          <rect x="0" y="0" width="30" height="80" fill="#f4f4f5" />
                          <rect x="4" y="8" width="22" height="4" rx="2" fill="#a1a1aa" />
                          <rect x="4" y="16" width="18" height="3" rx="1.5" fill="#d4d4d8" />
                          <rect x="4" y="22" width="20" height="3" rx="1.5" fill="#d4d4d8" />
                          <rect x="4" y="28" width="16" height="3" rx="1.5" fill="#d4d4d8" />
                          <rect x="36" y="8" width="78" height="64" rx="4" fill="#ffffff" />
                          <rect x="42" y="16" width="50" height="4" rx="2" fill="#d4d4d8" />
                          <rect x="42" y="24" width="66" height="3" rx="1.5" fill="#e5e5e5" />
                          <rect x="42" y="30" width="60" height="3" rx="1.5" fill="#e5e5e5" />
                          <rect x="42" y="36" width="55" height="3" rx="1.5" fill="#e5e5e5" />
                          <rect x="42" y="46" width="40" height="4" rx="2" fill="#d4d4d8" />
                          <rect x="42" y="54" width="66" height="3" rx="1.5" fill="#e5e5e5" />
                        </g>
                        <g clipPath="url(#right-half)">
                          <rect width="120" height="80" fill="#1a1d23" />
                          <rect x="0" y="0" width="30" height="80" fill="#2d2d2d" />
                          <rect x="4" y="8" width="22" height="4" rx="2" fill="#52525b" />
                          <rect x="4" y="16" width="18" height="3" rx="1.5" fill="#3f3f46" />
                          <rect x="4" y="22" width="20" height="3" rx="1.5" fill="#3f3f46" />
                          <rect x="4" y="28" width="16" height="3" rx="1.5" fill="#3f3f46" />
                          <rect x="36" y="8" width="78" height="64" rx="4" fill="#2d2d2d" />
                          <rect x="42" y="16" width="50" height="4" rx="2" fill="#52525b" />
                          <rect x="42" y="24" width="66" height="3" rx="1.5" fill="#3f3f46" />
                          <rect x="42" y="30" width="60" height="3" rx="1.5" fill="#3f3f46" />
                          <rect x="42" y="36" width="55" height="3" rx="1.5" fill="#3f3f46" />
                          <rect x="42" y="46" width="40" height="4" rx="2" fill="#52525b" />
                          <rect x="42" y="54" width="66" height="3" rx="1.5" fill="#3f3f46" />
                        </g>
                        <line x1="60" y1="0" x2="60" y2="80" stroke="#71717a" strokeWidth="0.5" />
                      </>
                    )}
                  </svg>
                </span>
                <span
                  className="text-xs font-medium"
                  style={{ color: isSelected ? 'var(--zy-primary)' : 'var(--zy-text-primary)' }}
                >
                  {i18nService.t(mode)}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderTabContent = () => {
    if (isEnterpriseTab(activeTab)) {
      const pageId = fromEnterpriseTab(activeTab);
      const page = enterpriseSettingsPages.find(candidate => candidate.id === pageId);
      return page ? <EnterpriseSettingsPage page={page} title={activeTabLabel} /> : null;
    }
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-8">
            {/* Language Section */}
            <GeneralLanguageField
              value={language}
              onValueChange={nextLanguage => {
                setLanguage(nextLanguage);
                i18nService.setLanguage(nextLanguage, { persist: false });
              }}
            />

            {/* Auto-launch Section */}
            <SettingsToggleRow
              label={i18nService.t('autoLaunch')}
              description={i18nService.t('autoLaunchDescription')}
              checked={autoLaunch}
              onCheckedChange={async next => {
                if (isUpdatingAutoLaunch) return;
                setIsUpdatingAutoLaunch(true);
                try {
                  const result = await window.electron.autoLaunch.set(next);
                  if (result.success) {
                    setAutoLaunchState(next);
                  } else {
                    setError(result.error || 'Failed to update auto-launch setting');
                  }
                } catch (err) {
                  console.error('Failed to set auto-launch:', err);
                  setError('Failed to update auto-launch setting');
                } finally {
                  setIsUpdatingAutoLaunch(false);
                }
              }}
              disabled={isUpdatingAutoLaunch}
            />

            {/* Prevent Sleep Section */}
            <SettingsToggleRow
              label={i18nService.t('preventSleep')}
              description={i18nService.t('preventSleepDescription')}
              checked={preventSleep}
              onCheckedChange={async next => {
                if (isUpdatingPreventSleep) return;
                setIsUpdatingPreventSleep(true);
                try {
                  const result = await window.electron.preventSleep.set(next);
                  if (result.success) {
                    setPreventSleepState(next);
                  } else {
                    setError(result.error || 'Failed to update prevent-sleep setting');
                  }
                } catch (err) {
                  console.error('Failed to set prevent-sleep:', err);
                  setError('Failed to update prevent-sleep setting');
                } finally {
                  setIsUpdatingPreventSleep(false);
                }
              }}
              disabled={isUpdatingPreventSleep}
            />

            {/* System proxy Section */}
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">
                {i18nService.t('useSystemProxy')}
              </h4>
              <label className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {i18nService.t('useSystemProxyDescription')}
                </span>
                <Switch
                  checked={useSystemProxy}
                  onCheckedChange={next => setUseSystemProxy(next)}
                />
              </label>
            </div>

            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">
                {i18nService.t('sqliteAutoBackupEnabled')}
              </h4>
              <label className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {i18nService.t('sqliteAutoBackupEnabledDescription')}
                </span>
                <Switch
                  checked={sqliteAutoBackupEnabled}
                  onCheckedChange={next => setSqliteAutoBackupEnabled(next)}
                />
              </label>
            </div>
          </div>
        );

      case 'appearance':
        return renderAppearanceSettings();

      case 'email':
        return null;

      case 'coworkMemory':
        return <ManagedMemorySettings workingDirectory={coworkConfig.workingDirectory} />;

      case 'model':
        return (
            <div className="flex h-full flex-col md:flex-row">
              {/* Provider List - Left Side */}
            <div className="min-h-0 max-h-56 w-full shrink-0 space-y-1.5 overflow-y-auto border-b border-border px-2 md:max-h-none md:w-2/5 md:border-b-0 md:border-r">
              <div className="flex items-center justify-between mb-2 px-1">
                <h3 className="text-sm font-medium text-foreground">
                  {i18nService.t('modelProviders')}
                </h3>
                <div className="flex items-center space-x-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleImportProvidersClick}
                    disabled={isImportingProviders || isExportingProviders}
                  >
                    {i18nService.t('import')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleExportProviders}
                    disabled={isImportingProviders || isExportingProviders}
                  >
                    {i18nService.t('export')}
                  </Button>
                </div>
              </div>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImportProviders}
              />
              {Object.entries(visibleProviders).map(([provider, config]) => {
                const providerKey = provider as ProviderType;
                const isCustom = isCustomProvider(provider);
                const hasValidAuth = hasProviderAuthConfigured(providerKey, config);
                const providerEnabled = isProviderEnabled(providerKey, config);
                const effectiveEnabled = providerRequiresApiKey(providerKey)
                  ? providerEnabled && hasValidAuth
                  : providerEnabled;
                const canToggleProvider = effectiveEnabled || hasValidAuth;
                const displayLabel = isCustom
                  ? (config as ProviderConfig).displayName || getCustomProviderLabel(provider)
                  : (ProviderRegistry.get(providerKey)?.label ?? getProviderDisplayName(provider));
                return (
                  <div
                    key={provider}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleProviderChange(providerKey)}
                    onKeyDown={e => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      handleProviderChange(providerKey);
                    }}
                    className={cn(
                      'group flex items-center p-2 rounded-xl cursor-pointer transition-colors active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 border',
                      activeProvider === provider
                        ? 'bg-surface shadow-elevated border-border'
                        : 'bg-surface hover:bg-surface-raised border-transparent',
                    )}
                  >
                    <div className="flex flex-1 items-center min-w-0">
                      <div className="mr-2 flex h-7 w-7 items-center justify-center shrink-0">
                        <span className="text-foreground">{getProviderIcon(provider)}</span>
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium truncate text-foreground">
                          {displayLabel}
                        </span>
                        {isCustom && (
                          <span className="text-[9px] leading-tight mt-0.5 text-primary">
                            {i18nService.t('customBadge')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center ml-2 gap-1">
                      {isCustom && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive h-auto w-auto p-0.5"
                          onClick={e => {
                            e.stopPropagation();
                            handleDeleteCustomProvider(providerKey);
                          }}
                          title={i18nService.t('deleteCustomProvider')}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Switch
                        checked={effectiveEnabled}
                        onCheckedChange={() => {
                          if (!canToggleProvider) return;
                          toggleProviderEnabled(providerKey);
                        }}
                        className={
                          !canToggleProvider ? 'pointer-events-none cursor-not-allowed' : ''
                        }
                      />
                    </div>
                  </div>
                );
              })}
              {/* Add Custom Provider Button */}
              {CUSTOM_PROVIDER_KEYS.some(k => !providers[k]) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAddCustomProvider}
                  className="w-full border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary"
                >
                  {i18nService.t('addCustomProvider')}
                </Button>
              )}
            </div>

            {/* Provider Settings - Right Side */}
            <div className="min-h-0 w-full min-w-0 flex-1 space-y-4 overflow-y-auto pl-4 pr-2 scrollbar-gutter-stable md:w-3/5 md:flex-none">
              {activeProvider !== ProviderName.LlamaCpp &&
                (() => {
                  return (
                    <div
                      className={cn(
                        'flex items-center pb-2 border-b border-border',
                        isCustomProvider(activeProvider) && 'order-[-4]',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-base font-medium text-foreground">
                          {isCustomProvider(activeProvider)
                            ? (providers[activeProvider] as ProviderConfig)?.displayName ||
                              getCustomProviderLabel(activeProvider)
                            : (ProviderRegistry.get(activeProvider)?.label ??
                              getProviderDisplayName(activeProvider))}{' '}
                          {i18nService.t('providerSettings')}
                        </h3>
                        {ProviderRegistry.get(activeProvider)?.website && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              void window.electron.shell.openExternal(
                                ProviderRegistry.get(activeProvider)!.website!,
                              )
                            }
                            className="text-muted-foreground hover:text-primary"
                            title={i18nService.t('visitOfficialSite')}
                            aria-label={i18nService.t('visitOfficialSite')}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })()}

              {/* MiniMax OAuth auth section */}
              {activeProvider === 'minimax' && (
                <div className="space-y-3">
                  {/* Auth type radio cards */}
                  <div>
                    <p className="text-sm font-medium text-foreground mb-2">
                      {i18nService.t('minimaxAuthMethodLabel')}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setProviders(prev => ({
                            ...prev,
                            minimax: {
                              ...prev.minimax,
                              authType: 'apikey',
                              enabled:
                                prev.minimax.enabled && prev.minimax.apiKey.trim().length > 0,
                            },
                          }));
                          setMinimaxOAuthPhase({ kind: 'idle' });
                        }}
                        className={`flex-1 p-3 rounded-lg border text-left transition-[background-color,border-color,opacity] ${!minimaxIsOAuthMode ? 'border-primary bg-primary/5' : 'border-border opacity-60 hover:opacity-80'}`}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <Key className="h-4 w-4 text-foreground shrink-0" />
                          <p className="text-sm font-semibold text-foreground">
                            {i18nService.t('minimaxOAuthTabApiKey')}
                          </p>
                        </div>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setProviders(prev => ({
                            ...prev,
                            minimax: {
                              ...prev.minimax,
                              authType: 'oauth',
                              enabled:
                                prev.minimax.enabled &&
                                (prev.minimax.oauthAccessToken?.trim().length ?? 0) > 0,
                            },
                          }))
                        }
                        className={`flex-1 p-3 rounded-lg border text-left transition-[background-color,border-color,opacity] ${minimaxIsOAuthMode ? 'border-primary bg-primary/5' : 'border-border opacity-60 hover:opacity-80'}`}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-foreground shrink-0" />
                          <p className="text-sm font-semibold text-foreground">
                            {i18nService.t('minimaxOAuthTabOAuth')}
                          </p>
                        </div>
                      </Button>
                    </div>
                  </div>

                  {/* API Key mode */}
                  {!minimaxIsOAuthMode && (
                    <div className="min-h-[68px]">
                      <div className="flex items-center justify-between mb-1">
                        <label
                          htmlFor="minimax-apiKey"
                          className="block text-sm font-medium text-foreground"
                        >
                          {i18nService.t('apiKey')}
                          <span className="text-destructive ml-0.5">*</span>
                        </label>
                        {ProviderRegistry.get('minimax')?.apiKeyUrl && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              void window.electron.shell.openExternal(
                                ProviderRegistry.get('minimax')!.apiKeyUrl!,
                              )
                            }
                             className="h-auto px-0 py-0 text-xs text-primary hover:underline"
                          >
                            {i18nService.t('getApiKey')}
                          </Button>
                        )}
                      </div>
                      <div className="relative">
                        <Input
                          type={showApiKey ? 'text' : 'password'}
                          id="minimax-apiKey"
                          value={providers.minimax.apiKey}
                          onChange={e =>
                            handleProviderConfigChange('minimax', 'apiKey', e.target.value)
                          }
                          className="pr-20 text-sm"
                          placeholder={i18nService.t('apiKeyPlaceholder')}
                        />
                        <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => setShowApiKey(!showApiKey)}
                                  aria-label={
                                    showApiKey
                                      ? i18nService.t('hide') || 'Hide'
                                      : i18nService.t('show') || 'Show'
                                  }
                                >
                                  {showApiKey ? <Eye /> : <EyeOff />}
                                </Button>
                              }
                            />
                            <TooltipContent>
                              {showApiKey
                                ? i18nService.t('hide') || 'Hide'
                                : i18nService.t('show') || 'Show'}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => requestApiKeyClear('minimax')}
                                    aria-label={i18nService.t('clear') || 'Clear'}
                                  >
                                    <XCircle />
                                  </Button>
                                }
                              />
                              <TooltipContent>{i18nService.t('clear') || 'Clear'}</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* OAuth mode */}
                  {minimaxIsOAuthMode && (
                    <div className="space-y-2 min-h-[68px]">
                      {/* Already logged in */}
                      {minimaxOAuthPhase.kind === 'idle' && providers.minimax.oauthAccessToken && (
                        <div className="p-3 rounded-xl bg-success/10 border border-success/20 space-y-2">
                          <p className="text-xs text-success font-medium">
                            {i18nService.t('minimaxOAuthLoggedIn')}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleMiniMaxDeviceLogin(minimaxOAuthRegion)}
                               className="h-auto px-2.5 py-1 text-xs"
                            >
                              {i18nService.t('minimaxOAuthRelogin')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleMiniMaxOAuthLogout}
                               className="h-auto px-2.5 py-1 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                            >
                              {i18nService.t('minimaxOAuthLogout')}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Not logged in yet — show region selector + login button */}
                      {minimaxOAuthPhase.kind === 'idle' && !providers.minimax.oauthAccessToken && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-sm font-medium text-foreground mb-1">
                              {i18nService.t('minimaxOAuthRegionLabel')}
                            </label>
                            <FluidTabs<MiniMaxRegion>
                              aria-label={i18nService.t('minimaxOAuthRegionLabel')}
                              items={[
                                { value: 'cn', label: i18nService.t('minimaxOAuthRegionCN') },
                                { value: 'global', label: i18nService.t('minimaxOAuthRegionGlobal') },
                              ]}
                              value={minimaxOAuthRegion}
                              onValueChange={setMinimaxOAuthRegion}
                            />
                          </div>
                          <Button
                            type="button"
                            onClick={() => handleMiniMaxDeviceLogin(minimaxOAuthRegion)}
                            className="w-full py-2 text-sm h-auto"
                          >
                            {i18nService.t('minimaxOAuthLogin')}
                          </Button>
                           <p className="text-xs text-muted-foreground">
                            {i18nService.t('minimaxOAuthHint')}
                          </p>
                        </div>
                      )}

                      {/* Requesting code */}
                      {minimaxOAuthPhase.kind === 'requesting_code' && (
                        <div className="p-3 rounded-xl bg-surface-inset border border-border">
                          <p className="text-xs text-muted-foreground">
                            {i18nService.t('minimaxOAuthLoggingIn')}
                          </p>
                        </div>
                      )}

                      {/* Pending — show user code */}
                      {minimaxOAuthPhase.kind === 'pending' && (
                        <div className="p-3 rounded-xl bg-surface-inset border border-border space-y-2">
                          <p className="text-xs text-foreground font-medium">
                            {i18nService.t('minimaxOAuthOpenBrowserHint')}
                          </p>
                          <div>
                             <span className="text-xs text-muted-foreground">
                              {i18nService.t('minimaxOAuthUserCode')}:&nbsp;
                            </span>
                            <code className="text-xs font-mono text-primary">
                              {minimaxOAuthPhase.userCode}
                            </code>
                          </div>
                          <a
                            href={minimaxOAuthPhase.verificationUri}
                            onClick={e => {
                              e.preventDefault();
                              void window.electron.shell.openExternal(
                                minimaxOAuthPhase.verificationUri,
                              );
                            }}
                             className="block text-xs text-primary underline truncate"
                          >
                            {minimaxOAuthPhase.verificationUri}
                          </a>
                           <p className="text-xs text-muted-foreground">
                            {i18nService.t('minimaxOAuthStatusPending')}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCancelMiniMaxLogin}
                             className="h-auto px-2.5 py-1 text-xs"
                          >
                            {i18nService.t('minimaxOAuthCancel')}
                          </Button>
                        </div>
                      )}

                      {/* Success */}
                      {minimaxOAuthPhase.kind === 'success' && (
                        <div className="p-3 rounded-xl bg-success/10 border border-success/20">
                          <p className="text-xs text-success font-medium">
                            {i18nService.t('minimaxOAuthStatusSuccess')}
                          </p>
                        </div>
                      )}

                      {/* Error */}
                      {minimaxOAuthPhase.kind === 'error' && (
                        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 space-y-2">
                          <p className="text-xs text-destructive font-medium">
                            {i18nService.t('minimaxOAuthStatusError')}
                          </p>
                           <p className="text-xs text-destructive/80 wrap-break-word">
                            {minimaxOAuthPhase.message}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleMiniMaxDeviceLogin(minimaxOAuthRegion)}
                               className="h-auto px-2.5 py-1 text-xs"
                            >
                              {i18nService.t('minimaxOAuthRelogin')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setMinimaxOAuthPhase({ kind: 'idle' })}
                               className="h-auto px-2.5 py-1 text-xs"
                            >
                              {i18nService.t('minimaxOAuthCancel')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* OpenAI ChatGPT (Codex) OAuth auth section */}
              {activeProvider === 'openai' && (
                <div className="space-y-3">
                  {/* Auth type radio cards */}
                  <div>
                     <p className="text-sm font-medium text-foreground mb-2">
                      {i18nService.t('openaiAuthMethodLabel')}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setProviders(prev => ({
                            ...prev,
                            openai: {
                              ...prev.openai,
                              authType: 'apikey',
                            },
                          }));
                          setOpenaiOAuthPhase({ kind: 'idle' });
                        }}
                        className={`flex-1 p-3 rounded-lg border text-left transition-[background-color,border-color,opacity] ${!openaiIsOAuthMode ? 'border-primary bg-primary/5' : 'border-border opacity-60 hover:opacity-80'}`}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <Key className="h-4 w-4 text-foreground shrink-0" />
                           <p className="text-sm font-semibold text-foreground">
                            {i18nService.t('openaiOAuthTabApiKey')}
                          </p>
                        </div>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setProviders(prev => ({
                            ...prev,
                            openai: {
                              ...prev.openai,
                              authType: 'oauth',
                            },
                          }))
                        }
                        className={`flex-1 p-3 rounded-lg border text-left transition-[background-color,border-color,opacity] ${openaiIsOAuthMode ? 'border-primary bg-primary/5' : 'border-border opacity-60 hover:opacity-80'}`}
                      >
                        <div className="flex items-center justify-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-foreground shrink-0" />
                           <p className="text-sm font-semibold text-foreground">
                            {i18nService.t('openaiOAuthTabOAuth')}
                          </p>
                        </div>
                      </Button>
                    </div>
                  </div>

                  {/* OAuth mode UI */}
                  {openaiIsOAuthMode && (
                    <div className="space-y-2 min-h-[68px]">
                      {/* Idle + already logged in */}
                      {openaiOAuthPhase.kind === 'idle' && openaiOAuthStatus?.loggedIn && (
                        <div className="p-3 rounded-xl bg-success/10 border border-success/20 space-y-2">
                          <p className="text-xs text-success font-medium">
                            {i18nService.t('openaiOAuthLoggedIn')}
                            {openaiOAuthStatus.email ? ` (${openaiOAuthStatus.email})` : ''}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleOpenAIOAuthLogin}
                               className="h-auto px-2.5 py-1 text-xs"
                            >
                              {i18nService.t('openaiOAuthRelogin')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                void handleOpenAIOAuthLogout();
                              }}
                               className="h-auto px-2.5 py-1 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                            >
                              {i18nService.t('openaiOAuthLogout')}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Idle + not logged in — show login CTA */}
                      {openaiOAuthPhase.kind === 'idle' &&
                        openaiOAuthStatus &&
                        !openaiOAuthStatus.loggedIn && (
                          <div className="space-y-2">
                            <Button
                              type="button"
                              onClick={handleOpenAIOAuthLogin}
                              className="w-full py-2 text-xs h-auto"
                            >
                              {i18nService.t('openaiOAuthLogin')}
                            </Button>
                             <p className="text-xs text-muted-foreground">
                              {i18nService.t('openaiOAuthHint')}
                            </p>
                          </div>
                        )}

                      {/* Pending — browser opened, waiting for callback */}
                      {openaiOAuthPhase.kind === 'pending' && (
                        <div className="p-3 rounded-xl bg-surface-inset border border-border space-y-2">
                          <p className="text-xs text-foreground font-medium">
                            {i18nService.t('openaiOAuthOpenBrowserHint')}
                          </p>
                           <p className="text-xs text-muted-foreground">
                            {i18nService.t('openaiOAuthStatusPending')}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              void handleCancelOpenAIOAuthLogin();
                            }}
                             className="h-auto px-2.5 py-1 text-xs"
                          >
                            {i18nService.t('openaiOAuthCancel')}
                          </Button>
                        </div>
                      )}

                      {/* Success */}
                      {openaiOAuthPhase.kind === 'success' && (
                        <div className="p-3 rounded-xl bg-success/10 border border-success/20">
                          <p className="text-xs text-success font-medium">
                            {i18nService.t('openaiOAuthStatusSuccess')}
                            {openaiOAuthPhase.email ? ` (${openaiOAuthPhase.email})` : ''}
                          </p>
                        </div>
                      )}

                      {/* Error */}
                      {openaiOAuthPhase.kind === 'error' && (
                        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 space-y-2">
                          <p className="text-xs text-destructive font-medium">
                            {i18nService.t('openaiOAuthStatusError')}
                          </p>
                           <p className="text-xs text-destructive/80 wrap-break-word">
                            {openaiOAuthPhase.message}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={handleOpenAIOAuthLogin}
                               className="h-auto px-2.5 py-1 text-xs"
                            >
                              {i18nService.t('openaiOAuthRelogin')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setOpenaiOAuthPhase({ kind: 'idle' })}
                               className="h-auto px-2.5 py-1 text-xs"
                            >
                              {i18nService.t('openaiOAuthCancel')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div
                className={
                  isCustomProvider(activeProvider)
                    ? 'order-[-3] flex flex-col gap-4'
                    : 'flex flex-col gap-4'
                }
              >
              {/* Standard API key section for non-MiniMax providers */}
              {(providerRequiresApiKey(activeProvider) || isCustomProvider(activeProvider)) &&
                activeProvider !== 'minimax' &&
                !(activeProvider === 'openai' && openaiIsOAuthMode) && (
                  <div className={isCustomProvider(activeProvider) ? 'order-[-2]' : 'order-2'}>
                    {/* Standard API Key input for non-Qwen providers */}
                    {activeProvider !== 'qwen' && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label
                            htmlFor={`${activeProvider}-apiKey`}
                            className="block text-sm font-medium text-foreground"
                          >
                            {i18nService.t('apiKey')}
                            {providerRequiresApiKey(activeProvider) && (
                              <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>
                            )}
                          </label>
                          {ProviderRegistry.get(activeProvider)?.apiKeyUrl && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                void window.electron.shell.openExternal(
                                  ProviderRegistry.get(activeProvider)!.apiKeyUrl!,
                                )
                              }
                               className="h-auto px-0 py-0 text-xs text-primary hover:underline"
                            >
                              {i18nService.t('getApiKey')}
                            </Button>
                          )}
                        </div>
                        <div className="relative">
                          <Input
                            type={showApiKey ? 'text' : 'password'}
                            id={`${activeProvider}-apiKey`}
                            value={providers[activeProvider].apiKey}
                            onChange={e => handleApiKeyInputChange(activeProvider, e.target.value)}
                            onBlur={() => handleApiKeyBlur(activeProvider)}
                             className="pr-20 text-sm"
                            placeholder={i18nService.t('apiKeyPlaceholder')}
                          />
                          <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    aria-label={
                                      showApiKey
                                        ? i18nService.t('hide') || 'Hide'
                                        : i18nService.t('show') || 'Show'
                                    }
                                  >
                                    {showApiKey ? <Eye /> : <EyeOff />}
                                  </Button>
                                }
                              />
                              <TooltipContent>
                                {showApiKey
                                  ? i18nService.t('hide') || 'Hide'
                                  : i18nService.t('show') || 'Show'}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => requestApiKeyClear(activeProvider)}
                                      aria-label={i18nService.t('clear') || 'Clear'}
                                    >
                                      <XCircle />
                                    </Button>
                                  }
                                />
                                <TooltipContent>{i18nService.t('clear') || 'Clear'}</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Qwen API Key section */}
                    {activeProvider === 'qwen' && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label
                            htmlFor="qwen-apiKey"
                             className="block text-sm font-medium text-foreground"
                          >
                            API Key<span className="text-destructive ml-0.5">*</span>
                          </label>
                          {ProviderRegistry.get('qwen')?.apiKeyUrl && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                void window.electron.shell.openExternal(
                                  ProviderRegistry.get('qwen')!.apiKeyUrl!,
                                )
                              }
                               className="h-auto px-0 py-0 text-xs text-primary hover:underline"
                            >
                            {i18nService.t('getApiKey')}
                            </Button>
                          )}
                        </div>
                        <div className="relative">
                          <Input
                            type={showApiKey ? 'text' : 'password'}
                            id="qwen-apiKey"
                            value={providers.qwen.apiKey}
                            onChange={e => handleApiKeyInputChange('qwen', e.target.value)}
                            onBlur={() => handleApiKeyBlur('qwen')}
                             className="pr-20 text-sm"
                            placeholder={i18nService.t('apiKeyPlaceholder')}
                          />
                          <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    aria-label={
                                      showApiKey
                                        ? i18nService.t('hide') || 'Hide'
                                        : i18nService.t('show') || 'Show'
                                    }
                                  >
                                    {showApiKey ? <Eye /> : <EyeOff />}
                                  </Button>
                                }
                              />
                              <TooltipContent>
                                {showApiKey
                                  ? i18nService.t('hide') || 'Hide'
                                  : i18nService.t('show') || 'Show'}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      onClick={() => requestApiKeyClear('qwen')}
                                      aria-label={i18nService.t('clear') || 'Clear'}
                                    >
                                      <XCircle />
                                    </Button>
                                  }
                                />
                                <TooltipContent>{i18nService.t('clear') || 'Clear'}</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

              {activeProvider === 'github-copilot' && (
                <div className="order-2">
                   <label className="block text-sm font-medium text-foreground mb-2">
                    {i18nService.t('githubCopilotAuth')}
                  </label>

                  {(copilotAuthStatus === 'idle' || copilotAuthStatus === 'error') &&
                    !providers['github-copilot'].apiKey && (
                      <div className="space-y-2">
                        <Button
                          type="button"
                          onClick={handleCopilotSignIn}
                          className="flex items-center gap-2 px-4 py-2 text-xs h-auto"
                        >
                          <GitHubCopilotIcon className="w-4 h-4" />
                          {i18nService.t('githubCopilotSignIn')}
                        </Button>
                        {copilotError && (
                          <p className="text-xs text-destructive">{copilotError}</p>
                        )}
                      </div>
                    )}

                  {copilotAuthStatus === 'requesting' && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                      {i18nService.t('githubCopilotRequesting')}
                    </div>
                  )}

                  {(copilotAuthStatus === 'awaiting_user' || copilotAuthStatus === 'polling') && (
                    <div className="space-y-3">
                      <div className="p-3 rounded-xl bg-surface-raised border border-border">
                        <p className="text-xs text-muted-foreground mb-2">
                          {i18nService.t('githubCopilotEnterCode')}
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="text-lg font-mono font-bold tracking-widest text-foreground">
                            {copilotUserCode}
                          </code>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(copilotUserCode);
                            }}
                             className="h-auto px-2 py-0.5 text-xs"
                          >
                            {i18nService.t('copy') || 'Copy'}
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          onClick={() => window.electron.shell.openExternal(copilotVerificationUri)}
                          className="mt-2 h-auto px-0 py-0 text-xs"
                        >
                          {copilotVerificationUri}
                        </Button>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          {i18nService.t('githubCopilotWaiting')}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCopilotCancelAuth}
                          className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-destructive"
                        >
                          {i18nService.t('cancel')}
                        </Button>
                      </div>
                    </div>
                  )}

                  {(copilotAuthStatus === 'authenticated' || providers['github-copilot'].apiKey) &&
                    copilotAuthStatus !== 'requesting' &&
                    copilotAuthStatus !== 'awaiting_user' &&
                    copilotAuthStatus !== 'polling' && (
                      <div className="flex items-center justify-between p-3 rounded-xl bg-surface-raised border border-border">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-success" />
                          <span className="text-xs text-foreground">
                            {copilotGithubUser
                              ? `${i18nService.t('githubCopilotConnected')} @${copilotGithubUser}`
                              : i18nService.t('githubCopilotConnected')}
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleCopilotSignOut}
                          className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-destructive"
                        >
                          {i18nService.t('githubCopilotSignOut')}
                        </Button>
                      </div>
                    )}
                </div>
              )}

              {isCustomProvider(activeProvider) && (
                <div className="order-[-1]">
                  <label
                    htmlFor={`${activeProvider}-displayName`}
                    className="mb-1 block text-sm font-medium text-foreground"
                  >
                    {i18nService.t('customDisplayName')}
                  </label>
                  <Input
                    type="text"
                    id={`${activeProvider}-displayName`}
                    value={(providers[activeProvider] as ProviderConfig)?.displayName ?? ''}
                    onChange={e =>
                      handleProviderConfigChange(activeProvider, 'displayName', e.target.value)
                    }
                    className="text-sm"
                    placeholder={i18nService.t('customDisplayNamePlaceholder')}
                  />
                </div>
              )}

              {activeProvider !== ProviderName.LlamaCpp &&
                !(activeProvider === 'minimax' && minimaxIsOAuthMode) && (
                <div
                  className={isCustomProvider(activeProvider) ? 'order-[-3]' : 'order-1'}
                >
                  <label
                    htmlFor={`${activeProvider}-baseUrl`}
                    className="mb-1 block font-medium text-foreground"
                  >
                    <span className="text-sm">
                      {i18nService.t('baseUrl')}
                    </span>
                    {isCustomProvider(activeProvider) && (
                      <span className="ml-0.5 text-destructive">*</span>
                    )}
                  </label>
                  <div className="relative">
                    <Input
                      type="text"
                      id={`${activeProvider}-baseUrl`}
                      value={(() => {
                        // Coding plan override: delegate to ProviderRegistry (50e20b76)
                        const fmt = getEffectiveApiFormat(
                          activeProvider,
                          providers[activeProvider].apiFormat,
                        );
                        if (fmt !== 'gemini') {
                          const cpUrl = (
                            providers[activeProvider] as { codingPlanEnabled?: boolean }
                          ).codingPlanEnabled
                            ? ProviderRegistry.getCodingPlanUrl(activeProvider, fmt)
                            : undefined;
                          if (cpUrl) return cpUrl;
                        }
                        return providers[activeProvider].baseUrl;
                      })()}
                      onChange={e => handleBaseUrlInputChange(activeProvider, e.target.value)}
                      onBlur={() => handleBaseUrlBlur(activeProvider)}
                      disabled={isBaseUrlLocked}
                      className={cn(
                        'pr-10',
                        'text-sm',
                        isBaseUrlLocked && 'cursor-not-allowed opacity-50',
                      )}
                      placeholder={
                        activeProvider === 'qwen'
                          ? 'https://dashscope.aliyuncs.com/apps/anthropic'
                          : getProviderDefaultBaseUrl(
                              activeProvider,
                              getEffectiveApiFormat(
                                activeProvider,
                                providers[activeProvider].apiFormat,
                              ),
                            ) ||
                            defaultConfig.providers?.[activeProvider]?.baseUrl ||
                            i18nService.t('baseUrlPlaceholder')
                      }
                    />
                    {providers[activeProvider].baseUrl && !isBaseUrlLocked && (
                      <div className="absolute right-2 inset-y-0 flex items-center">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  handleProviderConfigChange(activeProvider, 'baseUrl', '')
                                }
                                aria-label={i18nService.t('clear') || 'Clear'}
                              >
                                <XCircle />
                              </Button>
                            }
                          />
                          <TooltipContent>{i18nService.t('clear') || 'Clear'}</TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                  {/* GLM Coding Plan 提示 */}
                  {activeProvider === 'zhipu' && providers.zhipu.codingPlanEnabled && (
                    <div className="mt-1.5 p-2 rounded-lg bg-primary-muted border border-primary-muted">
                      <p className="text-xs text-primary dark:text-primary">
                        <span className="font-medium">GLM Coding Plan:</span>{' '}
                        {i18nService.t('zhipuCodingPlanEndpointHint')}
                      </p>
                    </div>
                  )}
                  {/* Qwen Coding Plan 提示 */}
                  {activeProvider === 'qwen' && providers.qwen.codingPlanEnabled && (
                    <div className="mt-1.5 p-2 rounded-lg bg-primary-muted border border-primary-muted">
                      <p className="text-xs text-primary dark:text-primary">
                        <span className="font-medium">Coding Plan:</span>{' '}
                        {i18nService.t('qwenCodingPlanEndpointHint')}
                      </p>
                    </div>
                  )}
                  {/* Volcengine Coding Plan 提示 */}
                  {activeProvider === 'volcengine' && providers.volcengine.codingPlanEnabled && (
                    <div className="mt-1.5 p-2 rounded-lg bg-primary-muted border border-primary-muted">
                      <p className="text-xs text-primary dark:text-primary">
                        <span className="font-medium">Coding Plan:</span>{' '}
                        {i18nService.t('volcengineCodingPlanEndpointHint')}
                      </p>
                    </div>
                  )}
                  {/* Moonshot Coding Plan 提示 */}
                  {activeProvider === 'moonshot' && providers.moonshot.codingPlanEnabled && (
                    <div className="mt-1.5 p-2 rounded-lg bg-primary-muted border border-primary-muted">
                      <p className="text-xs text-primary dark:text-primary">
                        <span className="font-medium">Coding Plan:</span>{' '}
                        {i18nService.t('moonshotCodingPlanEndpointHint')}
                      </p>
                    </div>
                  )}
                  {/* Qianfan Coding Plan 提示 */}
                  {activeProvider === 'qianfan' && providers.qianfan.codingPlanEnabled && (
                    <div className="mt-1.5 p-2 rounded-lg bg-primary-muted border border-primary-muted">
                      <p className="text-xs text-primary dark:text-primary">
                        <span className="font-medium">Coding Plan:</span>{' '}
                        {i18nService.t('qianfanCodingPlanEndpointHint')}
                      </p>
                    </div>
                  )}
                  {/* Xiaomi Coding Plan 提示 */}
                  {activeProvider === 'xiaomi' && providers.xiaomi.codingPlanEnabled && (
                    <div className="mt-1.5 p-2 rounded-lg bg-primary-muted border border-primary-muted">
                      <p className="text-xs text-primary dark:text-primary">
                        <span className="font-medium">Coding Plan:</span>{' '}
                        {i18nService.t('xiaomiCodingPlanEndpointHint')}
                      </p>
                    </div>
                  )}
                </div>
                )}

              {/* API 格式选择器 */}
              {shouldShowApiFormatSelector(activeProvider) &&
                activeProvider !== ProviderName.LlamaCpp &&
                !(activeProvider === 'minimax' && minimaxIsOAuthMode) && (
                  <div className={isCustomProvider(activeProvider) ? undefined : 'order-3'}>
                    <label
                      htmlFor={`${activeProvider}-apiFormat`}
                      className="mb-1 block text-sm font-medium text-foreground"
                    >
                      {i18nService.t('apiFormat')}
                    </label>
                    <div className="flex items-center space-x-4">
                      <RadioGroup
                        value={
                          getEffectiveApiFormat(
                            activeProvider,
                            providers[activeProvider].apiFormat,
                          ) === 'openai'
                            ? 'openai'
                            : 'anthropic'
                        }
                        onValueChange={value =>
                          handleProviderConfigChange(activeProvider, 'apiFormat', value)
                        }
                        className="flex items-center space-x-4"
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem
                            value="anthropic"
                            id={`${activeProvider}-apiFormat-anthropic`}
                          />
                          <label
                            htmlFor={`${activeProvider}-apiFormat-anthropic`}
                            className="text-sm text-foreground"
                          >
                            {i18nService.t('apiFormatNative')}
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem
                            value="openai"
                            id={`${activeProvider}-apiFormat-openai`}
                          />
                          <label
                            htmlFor={`${activeProvider}-apiFormat-openai`}
                            className="text-sm text-foreground"
                          >
                            {i18nService.t('apiFormatOpenAI')}
                          </label>
                        </div>
                      </RadioGroup>
                    </div>
                  </div>
                )}

              </div>

              {/* GLM Coding Plan 开关 (仅 Zhipu) */}
              {activeProvider === 'zhipu' && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-foreground">GLM Coding Plan</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary-muted text-primary">
                        Beta
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {i18nService.t('zhipuCodingPlanHint')}
                    </p>
                  </div>
                  <Switch
                    checked={providers.zhipu.codingPlanEnabled ?? false}
                    onCheckedChange={checked =>
                      handleProviderConfigChange(
                        'zhipu',
                        'codingPlanEnabled',
                        checked ? 'true' : 'false',
                      )
                    }
                    className="ml-3"
                  />
                </div>
              )}

              {/* Qwen Coding Plan 开关 (仅 Qwen) */}
              {activeProvider === 'qwen' && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-foreground">Coding Plan</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary-muted text-primary">
                        {i18nService.t('codingPlanSubscriptionBadge')}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {i18nService.t('qwenCodingPlanHint')}
                    </p>
                  </div>
                  <Switch
                    checked={providers.qwen.codingPlanEnabled ?? false}
                    onCheckedChange={checked =>
                      handleProviderConfigChange(
                        'qwen',
                        'codingPlanEnabled',
                        checked ? 'true' : 'false',
                      )
                    }
                    className="ml-3"
                  />
                </div>
              )}

              {/* Volcengine Coding Plan 开关 (仅 Volcengine) */}
              {activeProvider === 'volcengine' && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-foreground">Coding Plan</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary-muted text-primary">
                        Beta
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {i18nService.t('volcengineCodingPlanHint')}
                    </p>
                  </div>
                  <Switch
                    checked={providers.volcengine.codingPlanEnabled ?? false}
                    onCheckedChange={checked =>
                      handleProviderConfigChange(
                        'volcengine',
                        'codingPlanEnabled',
                        checked ? 'true' : 'false',
                      )
                    }
                    className="ml-3"
                  />
                </div>
              )}

              {/* Moonshot Coding Plan 开关 (仅 Moonshot) */}
              {activeProvider === 'moonshot' && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-foreground">Coding Plan</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary-muted text-primary">
                        Beta
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {i18nService.t('moonshotCodingPlanHint')}
                    </p>
                  </div>
                  <Switch
                    checked={providers.moonshot.codingPlanEnabled ?? false}
                    onCheckedChange={checked =>
                      handleProviderConfigChange(
                        'moonshot',
                        'codingPlanEnabled',
                        checked ? 'true' : 'false',
                      )
                    }
                    className="ml-3"
                  />
                </div>
              )}

              {/* Qianfan Coding Plan 开关 (仅 Qianfan) */}
              {activeProvider === 'qianfan' && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-foreground">Coding Plan</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary-muted text-primary">
                        Beta
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {i18nService.t('qianfanCodingPlanHint')}
                    </p>
                  </div>
                  <Switch
                    checked={providers.qianfan.codingPlanEnabled ?? false}
                    onCheckedChange={checked =>
                      handleProviderConfigChange(
                        'qianfan',
                        'codingPlanEnabled',
                        checked ? 'true' : 'false',
                      )
                    }
                    className="ml-3"
                  />
                </div>
              )}

              {/* Xiaomi Coding Plan 开关 (仅 Xiaomi) */}
              {activeProvider === 'xiaomi' && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-surface border border-border">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-foreground">Coding Plan</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-md bg-primary-muted text-primary">
                        Beta
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {i18nService.t('xiaomiCodingPlanHint')}
                    </p>
                  </div>
                  <Switch
                    checked={providers.xiaomi.codingPlanEnabled ?? false}
                    onCheckedChange={checked =>
                      handleProviderConfigChange(
                        'xiaomi',
                        'codingPlanEnabled',
                        checked ? 'true' : 'false',
                      )
                    }
                    className="ml-3"
                  />
                </div>
              )}

              {
                <div
                  className={cn(
                    isCustomProvider(activeProvider) &&
                      'space-y-4',
                  )}
                >
                  <div className="rounded-lg border border-border bg-surface">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-1.5 pl-3 pr-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="text-sm font-medium text-foreground">
                          {i18nService.t('modelList')}
                        </p>
                      </div>
                      {activeProvider === ProviderName.LlamaCpp ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => void handleRefreshLlamaCppModels()}
                                disabled={isRefreshingLlamaCppModels}
                                aria-label={i18nService.t('refresh')}
                              >
                                <RefreshCw
                                  className={
                                    isRefreshingLlamaCppModels
                                      ? 'animate-spin motion-reduce:animate-none'
                                      : undefined
                                  }
                                />
                              </Button>
                            }
                          />
                          <TooltipContent>{i18nService.t('refresh')}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                        <ProviderModelDiscoveryButton
                          prominent={isCustomProvider(activeProvider)}
                          iconOnly
                          providerId={activeProvider}
                          provider={providers[activeProvider]}
                          baseUrl={resolveBaseUrl(
                            activeProvider,
                            providers[activeProvider].baseUrl,
                            getEffectiveApiFormat(
                              activeProvider,
                              providers[activeProvider].apiFormat,
                            ),
                          )}
                          apiFormat={getEffectiveApiFormat(
                            activeProvider,
                            providers[activeProvider].apiFormat,
                          )}
                          requiresApiKey={
                            providerRequiresApiKey(activeProvider) &&
                            providers[activeProvider].authType !== 'oauth'
                          }
                          autoDetectRequest={
                            autoDetectRequest?.provider === activeProvider
                              ? {
                                  providerId: activeProvider,
                                  requestId: autoDetectRequest.requestId,
                                }
                              : null
                          }
                          onModelsDiscovered={handleModelsDiscovered}
                        />
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                onClick={handleAddModel}
                                aria-label={i18nService.t('addModel')}
                              >
                                <PlusCircle />
                              </Button>
                            }
                          />
                          <TooltipContent>{i18nService.t('addModel')}</TooltipContent>
                        </Tooltip>
                        </div>
                      )}
                      </div>

                    <div className="max-h-60 divide-y divide-border overflow-y-auto">
                    {(providers[activeProvider].models ?? []).map(model => (
                      <div
                        key={model.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${i18nService.t('testConnection')} ${model.name}`}
                        className="flex min-h-12 cursor-pointer items-center px-3 py-2 transition-colors duration-150 ease-out hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-px"
                        onClick={event => {
                          if (event.target instanceof Element && event.target.closest('button')) {
                            return;
                          }
                          setSelectedModelId(model.id);
                          void handleTestConnection(model.id);
                        }}
                        onKeyDown={event => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          setSelectedModelId(model.id);
                          void handleTestConnection(model.id);
                        }}
                      >
                        <div className="flex w-full min-w-0 items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                            <div
                              className={cn(
                                'h-1.5 w-1.5 shrink-0 rounded-full',
                                getModelConnectionStatus(activeProvider, model.id) ===
                                  ModelConnectionStatus.Success
                                  ? 'bg-success'
                                  : getModelConnectionStatus(activeProvider, model.id) ===
                                      ModelConnectionStatus.Failure
                                    ? 'bg-destructive'
                                    : 'bg-muted-foreground',
                              )}
                            />
                            <div className="min-w-0">
                              <div
                                className={cn(
                                  'truncate font-medium text-foreground',
                                  'text-sm',
                                )}
                              >
                                {model.name}
                              </div>
                              {activeProvider !== ProviderName.LlamaCpp ? (
                                <div
                                  className={cn(
                                    'truncate text-muted-foreground',
                                    'text-xs',
                                  )}
                                >
                                  {model.id}
                                </div>
                              ) : null}
                              {isCustomProvider(activeProvider) &&
                                (model.maxTokens ||
                                  Object.values(model.capabilities ?? {}).some(
                                    status => status === ModelCapabilityStatus.Supported,
                                  )) && (
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                    {model.maxTokens && (
                                      <span>
                                        {i18nService.t('modelMaxOutputTokensShort')}:{' '}
                                        {formatDetectedTokenLimit(model.maxTokens)}
                                      </span>
                                    )}
                                    {MODEL_CAPABILITY_FIELDS.filter(
                                      field =>
                                        field.key !== 'imageInput' &&
                                        model.capabilities?.[field.key] ===
                                        ModelCapabilityStatus.Supported,
                                    ).map(field => (
                                      <span key={field.key}>{i18nService.t(field.labelKey)}</span>
                                    ))}
                                  </div>
                                )}
                            </div>
                          </div>
                          <div className="ml-auto flex shrink-0 items-center justify-end gap-1">
                            {model.supportsImage && (
                              <span
                                className={cn(
                                  'rounded-md bg-primary-muted px-1.5 py-0.5 text-primary',
                                  'text-xs',
                                )}
                              >
                                {i18nService.t('imageInput')}
                              </span>
                            )}
                            {activeProvider !== ProviderName.LlamaCpp && (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => {
                                    const openEditor = (runtimeContextWindow?: number) =>
                                      handleEditModel(
                                        model.id,
                                        model.name,
                                        model.supportsImage,
                                        model.capabilities,
                                        model.piRuntime,
                                        runtimeContextWindow ?? model.contextWindow,
                                        model.maxTokens,
                                      );
                                    if (activeProvider !== ProviderName.Ollama) {
                                      openEditor();
                                      return;
                                    }
                                    const providerConfig = providers[activeProvider];
                                    const apiFormat = getEffectiveApiFormat(
                                      activeProvider,
                                      providerConfig.apiFormat,
                                    );
                                    const openWithLocalRuntimeFallback = () => {
                                      void window.electron.ollama
                                        .listRunningModels()
                                        .then(runningModels =>
                                          openEditor(
                                            resolveOllamaRunningModelContext(
                                              model.id,
                                              runningModels,
                                            ),
                                          ),
                                        )
                                        .catch(() => openEditor());
                                    };
                                    void window.electron.api
                                      .fetchModels({
                                        baseUrl: resolveBaseUrl(
                                          activeProvider,
                                          providerConfig.baseUrl,
                                          apiFormat,
                                        ),
                                        apiKey: providerConfig.apiKey,
                                        apiFormat,
                                      })
                                      .then(result => {
                                        const contextWindow = result.success
                                          ? resolveDiscoveredModelContext(model.id, result.models)
                                          : undefined;
                                        if (contextWindow !== undefined) {
                                          openEditor(contextWindow);
                                          return;
                                        }
                                        openWithLocalRuntimeFallback();
                                      })
                                      .catch(openWithLocalRuntimeFallback);
                                  }}
                                  aria-label={`${i18nService.t('editModel')} ${model.name}`}
                                  title={i18nService.t('editModel')}
                                  className="text-muted-foreground hover:text-foreground"
                                >
                                  <Pencil />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => handleDeleteModel(model.id)}
                                  aria-label={`${i18nService.t('delete')} ${model.name}`}
                                  title={i18nService.t('delete')}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <Trash2 />
                                </Button>
                              </>
                            )}
                            {activeProvider === ProviderName.LlamaCpp && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => {
                                  void window.electron.llamacpp.getModelPreferences().then(preferences => {
                                    const preference = preferences[model.id];
                                    handleEditModel(
                                      model.id,
                                      model.name,
                                      model.supportsImage,
                                      { ...model.capabilities, ...preference?.capabilities },
                                      undefined,
                                      preference?.ctxSize ?? model.contextWindow,
                                      preference?.maxTokens ?? model.maxTokens,
                                    );
                                  });
                                }}
                                aria-label={`${i18nService.t('editModel')} ${model.name}`}
                                title={i18nService.t('editModel')}
                                className="size-5 text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                              >
                                <Pencil />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}

                    {(!providers[activeProvider].models ||
                      providers[activeProvider].models.length === 0) && (
                      <div className="p-3 text-center">
                        <p
                          className={cn(
                            'text-muted-foreground',
                            'text-sm',
                          )}
                        >
                          {i18nService.t('noModelsAvailable')}
                        </p>
                      </div>
                    )}
                    </div>
                  </div>
                </div>
              }

            </div>
          </div>
        );

      case 'triage':
        return (
          <div className="max-w-2xl space-y-6">
            <div>
              <h3 className="text-sm font-medium text-foreground">
                {i18nService.t('modelTriageTitle') || '自动模型路由'}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                各 Agent 在 Agent 设置的「路由」tab 中分别启用和配置。此处为全局默认参数。
              </p>
            </div>

            {/* Global Defaults */}
            <div className="rounded-xl border border-border bg-surface/40 p-4 space-y-3">
              <h4 className="text-sm font-medium text-foreground">全局默认参数</h4>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm text-foreground">冷却轮次</label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    切换后需等待 N 轮才能再次切换，防止频繁抖动
                  </p>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={triageCooldownRounds}
                  onChange={async e => {
                    const value = Math.max(1, Number(e.target.value) || 3);
                    setTriageCooldownRounds(value);
                    const config = await window.electron.triage.getConfig();
                    await window.electron.triage.setConfig({
                      ...config,
                      rules: { ...config.rules, cooldownRounds: value },
                    });
                  }}
                  className="w-20 text-sm text-center shrink-0"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm text-foreground">对话路由上限</label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    超过此轮数后视为深度对话，使用默认模型
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-muted-foreground">轮</span>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={triageMaxConversationRounds}
                    onChange={async e => {
                      const value = Math.max(1, Number(e.target.value) || 20);
                      setTriageMaxConversationRounds(value);
                      const config = await window.electron.triage.getConfig();
                      await window.electron.triage.setConfig({
                        ...config,
                        rules: { ...config.rules, maxConversationRoundsForTriage: value },
                      });
                    }}
                    className="w-20 text-sm text-center"
                  />
                </div>
              </div>
            </div>

            {/* Local Model Classifier */}
            <div className="rounded-xl border border-border bg-surface/40 p-4 space-y-3">
              <h4 className="text-sm font-medium text-foreground">本地模型分类（实验性）</h4>
              <p className="text-xs text-muted-foreground">
                规则无法确定路由目标时，调用本地 llama.cpp 小模型进行分类
              </p>

              <div className="flex items-center justify-between pt-1">
                <div>
                  <span className="text-sm text-foreground">
                    {i18nService.t('modelTriageUseLocalModelLabel') || '使用本地小模型辅助分类'}
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    需先在本地推理页启动 llama.cpp 并加载模型
                  </p>
                </div>
                <Switch
                  checked={triageUseLocalModel}
                  onCheckedChange={async value => {
                    setTriageUseLocalModel(value);
                    const config = await window.electron.triage.getConfig();
                    await window.electron.triage.setConfig({
                      ...config,
                      rules: { ...config.rules, useLocalModelTriage: value },
                    });
                  }}
                  className="shrink-0 ml-2"
                />
              </div>

              {triageUseLocalModel && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">
                    {i18nService.t('modelTriageModelNameLabel') || '分类模型名称'}
                  </label>
                  <Input
                    type="text"
                    value={triageModelName}
                    onChange={async e => {
                      const value = e.target.value;
                      setTriageModelName(value);
                      const config = await window.electron.triage.getConfig();
                      await window.electron.triage.setConfig({
                        ...config,
                        rules: { ...config.rules, triageModelName: value },
                      });
                    }}
                    placeholder={
                      i18nService.t('modelTriageModelNamePlaceholder') || '例如: qwen2.5-0.5b'
                    }
                    className="w-full max-w-xs text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {i18nService.t('modelTriageModelNameNote') ||
                      '需要先在本地推理中加载该模型。推荐使用 0.5B-1B 的轻量模型。'}
                  </p>
                </div>
              )}
            </div>
          </div>
        );

      case 'coworkAgent': {
        const bootstrapTabs = [
          {
            key: 'IDENTITY.md' as const,
            titleKey: 'coworkBootstrapIdentityTitle',
            hintKey: 'coworkBootstrapIdentityHint',
            value: bootstrapIdentity,
            setter: setBootstrapIdentity,
          },
          {
            key: 'SOUL.md' as const,
            titleKey: 'coworkBootstrapSoulTitle',
            hintKey: 'coworkBootstrapSoulHint',
            value: bootstrapSoul,
            setter: setBootstrapSoul,
          },
          {
            key: 'USER.md' as const,
            titleKey: 'coworkBootstrapUserTitle',
            hintKey: 'coworkBootstrapUserHint',
            value: bootstrapUser,
            setter: setBootstrapUser,
          },
        ];
        const activeItem = bootstrapTabs.find(t => t.key === bootstrapTab) ?? bootstrapTabs[0];
        return (
          <div className="flex flex-col h-full space-y-4">
            <FluidTabs
              aria-label={activeTabLabel}
              items={bootstrapTabs.map(tab => ({ value: tab.key, label: i18nService.t(tab.titleKey) }))}
              value={activeItem.key}
              onValueChange={setBootstrapTab}
            />
            <div className="flex flex-col flex-1 min-h-0 space-y-2">
              <p className="text-xs text-muted-foreground shrink-0">
                {i18nService.t(activeItem.hintKey)}
              </p>
              <Textarea
                key={activeItem.key}
                value={activeItem.value}
                onChange={e => activeItem.setter(e.target.value)}
                className="w-full flex-1 min-h-[280px] rounded-lg border px-3 py-2 text-sm leading-relaxed border-border bg-surface text-foreground resize-none"
                placeholder={i18nService.t('coworkBootstrapPlaceholder')}
              />
            </div>
          </div>
        );
      }

      case 'shortcuts':
        return (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-foreground mb-3">
                {i18nService.t('keyboardShortcuts')}
              </label>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{i18nService.t('newChat')}</span>
                  <ShortcutRecorder
                    value={shortcuts.newChat}
                    onChange={v => handleShortcutChange('newChat', v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{i18nService.t('search')}</span>
                  <ShortcutRecorder
                    value={shortcuts.search}
                    onChange={v => handleShortcutChange('search', v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">{i18nService.t('openSettings')}</span>
                  <ShortcutRecorder
                    value={shortcuts.settings}
                    onChange={v => handleShortcutChange('settings', v)}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground">
                    {i18nService.t('sendMessageShortcut')}
                  </span>
                  <SendShortcutSelect
                    value={shortcuts.sendMessage}
                    onChange={v => handleShortcutChange('sendMessage', v)}
                  />
                </div>
              </div>
            </div>
          </div>
        );

      case 'im':
        return <IMSettings />;

      case 'about': {
        const update = appUpdateState;
        const progress = update?.progress;
        const isDownloading = update?.status === AppUpdateStatus.Downloading;
        const formatBytes = (value: number) =>
          value < 1024 * 1024
            ? `${Math.round(value / 1024)} KB`
            : `${(value / (1024 * 1024)).toFixed(1)} MB`;
        return (
          <div className="flex min-h-full flex-col items-center pt-6 pb-3">
            {/* Logo & App Name */}
            <img
              src="zhiyuan-logo-light.svg"
              alt="知远"
              className="logo-light h-16 w-auto mb-3 select-none"
            />
            <img
              src="zhiyuan-logo-dark.svg"
              alt="知远"
              className="logo-dark h-16 w-auto mb-3 select-none"
            />
            <span className="text-xs text-muted-foreground mt-1">v{appVersion}</span>
            <span className="text-xs text-muted-foreground mt-0.5">开放源码，汇聚智慧</span>

            {/* Info Card */}
            <div className="w-full mt-8 rounded-xl border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm text-foreground">{i18nService.t('aboutVersion')}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{appVersion}</span>
                </div>
              </div>
              <div className="px-4 py-3 border-b border-border space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-foreground">
                    {i18nService.t('updateSectionTitle')}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {update?.status === AppUpdateStatus.Checking
                      ? i18nService.t('updateChecking')
                      : update?.status === AppUpdateStatus.UpToDate
                        ? i18nService.t('updateUpToDate')
                        : update?.status === AppUpdateStatus.Error
                          ? i18nService.t('updateCheckFailed')
                          : update?.info?.latestVersion
                            ? `v${update.info.latestVersion}`
                            : i18nService.t('updateNotChecked')}
                  </span>
                </div>
                {isDownloading ? (
                  <>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full bg-primary transition-[width] duration-200 ${progress?.percent === undefined ? 'w-1/3 animate-pulse' : ''}`}
                        style={{
                          width:
                            progress?.percent === undefined
                              ? undefined
                              : `${Math.min(100, Math.max(0, progress.percent * 100))}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {progress
                          ? `${formatBytes(progress.received)}${progress.total ? ` / ${formatBytes(progress.total)}` : ''}`
                          : i18nService.t('updateDownloading')}
                      </span>
                      <span>
                        {progress?.percent !== undefined
                          ? `${Math.round(progress.percent * 100)}%`
                          : ''}
                        {progress?.speed ? ` · ${formatBytes(progress.speed)}/s` : ''}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void window.electron.appUpdate.cancelDownload()}
                      >
                        {i18nService.t('updateDownloadCancel')}
                      </Button>
                    </div>
                  </>
                ) : update?.status === AppUpdateStatus.Ready ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      void window.electron.appUpdate.installReady().then(result => {
                        if (!result.success) {
                          window.dispatchEvent(
                            new CustomEvent('app:showToast', {
                              detail: result.error || i18nService.t('updateInstallFailed'),
                            }),
                          );
                        }
                      });
                    }}
                  >
                    {i18nService.t('updateReadyConfirm')}
                  </Button>
                ) : update?.status === AppUpdateStatus.Error && update.info ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-destructive">
                      {update.errorMessage || i18nService.t('updateDownloadFailed')}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => void window.electron.appUpdate.retryDownload()}
                    >
                      {i18nService.t('updateRetry')}
                    </Button>
                  </div>
                ) : update?.status === AppUpdateStatus.Available ? (
                  <div className="space-y-2">
                    {update.info?.manualDownloadOnly ? (
                      <div className="text-xs text-muted-foreground">
                        {i18nService.t('updateManualOnly')}
                      </div>
                    ) : null}
                    <Button
                      size="sm"
                      onClick={() => void window.electron.appUpdate.retryDownload()}
                    >
                      {i18nService.t(
                        update.info?.manualDownloadOnly
                          ? 'updateOpenDownloadPage'
                          : 'updateDownloadNow',
                      )}
                    </Button>
                  </div>
                ) : update?.status !== AppUpdateStatus.Checking &&
                  update?.status !== AppUpdateStatus.UpToDate ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void window.electron.appUpdate.checkNow({ manual: true })}
                  >
                    {i18nService.t('updateCheckNow')}
                  </Button>
                ) : null}
                {update?.status === AppUpdateStatus.Error && !update.info ? (
                  <div className="text-xs text-destructive">
                    {update.errorMessage || i18nService.t('updateCheckFailed')}
                  </div>
                ) : null}
                {update?.lastCheckedAt ? (
                  <div className="text-xs text-muted-foreground">
                    {i18nService.t('updateLastChecked')}
                    {new Date(update.lastCheckedAt).toLocaleString()}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm text-foreground">GitHub</span>
                <a
                  href="https://github.com/rongxinzy/RongxinAI"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary hover:underline transition-colors"
                >
                  {i18nService.t('mcpViewOnGithub')}
                </a>
              </div>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm text-foreground">
                  {i18nService.t('aboutOfficialWebsite')}
                </span>
                <a
                  href={OFFICIAL_WEBSITE_URL}
                  onClick={event => {
                    event.preventDefault();
                    void window.electron.shell.openExternal(OFFICIAL_WEBSITE_URL);
                  }}
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary hover:underline transition-colors"
                >
                  {OFFICIAL_WEBSITE_URL}
                </a>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-foreground">关于我们</span>
                <a
                  href="http://www.rongxzy.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-primary hover:underline transition-colors"
                >
                  北京容芯致远科技有限公司
                </a>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-auto w-full pt-14 pb-2 flex flex-col items-center">
              <div className="flex items-center justify-center text-sm text-muted-foreground">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={e => {
                    e.stopPropagation();
                    void handleExportLogs();
                  }}
                  disabled={isExportingLogs}
                  className="text-muted-foreground hover:text-primary"
                >
                  {isExportingLogs
                    ? i18nService.t('aboutExportingLogs')
                    : i18nService.t('aboutExportLogs')}
                </Button>
              </div>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <Modal
      onClose={onClose}
      disablePointerDismissal
      className="w-auto sm:max-w-none p-0 ring-0! bg-transparent"
    >
      <div
        className="relative flex h-[min(80vh,calc(100vh-24px))] w-[min(900px,calc(100vw-24px))] min-w-0 rounded-[inherit] overflow-hidden modal-content bg-surface shadow-modal border border-border"
        onClick={handleSettingsClick}
      >
        {/* Left sidebar */}
        <div className="w-[180px] sm:w-[220px] shrink-0 flex flex-col bg-surface-raised border-r border-border-subtle rounded-l-2xl overflow-y-auto">
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-lg font-semibold text-foreground">{i18nService.t('settings')}</h2>
          </div>
          <nav className="flex flex-col gap-0.5 px-3 pb-4">
            {sidebarTabs.map(tab => (
              <Button
                type="button"
                key={tab.key}
                variant="ghost"
                onClick={() => handleTabChange(tab.key)}
                onMouseEnter={() => startSettingsIconAnimation(tab.key)}
                onMouseLeave={() => stopSettingsIconAnimation(tab.key)}
                className={cn(
                  'flex w-full items-center justify-start gap-3 rounded-lg border border-transparent bg-transparent px-3 py-2 text-sm font-medium !transition-colors !duration-200 ease-out',
                  activeTab === tab.key
                    ? 'border-border bg-card text-foreground hover:border-border hover:!bg-card hover:!text-foreground'
                    : 'text-muted-foreground hover:border-border hover:!bg-card hover:!text-foreground',
                )}
              >
                {tab.icon}
                <span className="min-w-0 truncate">{tab.label}</span>
              </Button>
            ))}
          </nav>
        </div>

        {/* Right content */}
        <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden bg-background rounded-r-2xl">
          {/* Content header */}
          <div className="flex justify-between items-center gap-3 px-4 sm:px-6 pt-5 pb-3 shrink-0">
            <h3 className="text-lg font-semibold text-foreground">{activeTabLabel}</h3>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground p-1.5 hover:bg-surface-raised rounded-lg"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {noticeMessage && (
            <div className="px-4 sm:px-6">
              <ErrorMessage message={noticeMessage} onClose={() => setNoticeMessage(null)} />
            </div>
          )}

          {error && (
            <div className="px-4 sm:px-6">
              <ErrorMessage message={error} onClose={() => setError(null)} />
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            onKeyDown={handleSettingsFormKeyDown}
            className="flex flex-col flex-1 overflow-hidden"
          >
            {/* Tab content */}
            <div
              ref={contentRef}
              className={cn(
                'flex-1',
                isEnterpriseTab(activeTab)
                  ? 'overflow-hidden'
                  : 'overflow-y-auto px-4 py-4 sm:px-6',
              )}
              style={{ scrollbarGutter: 'stable' }}
            >
              <div className={activeTab === 'email' ? 'block' : 'hidden'}>
                <EmailSettingsPage ref={emailSettingsRef} />
              </div>
              {activeTab !== 'email' && renderTabContent()}
            </div>

            {/* Footer buttons */}
            {!isEnterpriseTab(activeTab) && (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-background p-4">
                <Button
                  type="button"
                  variant="outline"
                  className={localInferenceCompactButtonClass}
                  onClick={onClose}
                  disabled={isSaving}
                >
                  {i18nService.t('cancel')}
                </Button>
                <Button
                  type="submit"
                  variant="outline"
                  className={localInferenceCompactButtonClass}
                  disabled={isSaving}
                >
                  {isSaving ? i18nService.t('saving') : i18nService.t('save')}
                </Button>
              </div>
            )}
          </form>
        </div>

        <DestructiveConfirmDialog
          open={pendingDeleteProvider !== null}
          title={i18nService.t('deleteCustomProvider')}
          description={i18nService.t('confirmDeleteCustomProvider')}
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('deleteCustomProvider')}
          onCancel={() => setPendingDeleteProvider(null)}
          onConfirm={confirmDeleteCustomProvider}
        />

        <DestructiveConfirmDialog
          open={pendingApiKeyClearProvider !== null}
          title={i18nService.t('clearApiKeyConfirmTitle')}
          description={i18nService.t('clearApiKeyConfirmDescription')}
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('clear')}
          cancelVariant="outline"
          confirmVariant="outline"
          onCancel={() => setPendingApiKeyClearProvider(null)}
          onConfirm={confirmApiKeyClear}
        />

        <DestructiveConfirmDialog
          open={pendingDeleteModel !== null}
          title={i18nService.t('confirmDelete')}
          description={
            pendingDeleteModel ? `${i18nService.t('delete')} "${pendingDeleteModel.name}"?` : ''
          }
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('delete')}
          cancelVariant="outline"
          confirmVariant="outline"
          onCancel={() => setPendingDeleteModel(null)}
          onConfirm={confirmDeleteModel}
        />

        <ProviderModelEditorDialog
          isOpen={isAddingModel || isEditingModel}
          isEditing={isEditingModel}
          providerName={activeProvider}
          draft={{
            id: newModelId,
            name: newModelName,
            contextWindow: newModelContextWindow,
            maxTokens: newModelMaxTokens,
            capabilities: newModelCapabilities,
            piRuntime: newModelPiRuntime,
          } satisfies ProviderModelEditorDraft}
          error={modelFormError}
          onDraftChange={patch => {
            if (patch.id !== undefined) setNewModelId(patch.id);
            if (patch.name !== undefined) setNewModelName(patch.name);
            if (patch.contextWindow !== undefined) setNewModelContextWindow(patch.contextWindow);
            if (patch.maxTokens !== undefined) setNewModelMaxTokens(patch.maxTokens);
            if (patch.capabilities !== undefined) setNewModelCapabilities(patch.capabilities);
            if ('piRuntime' in patch) setNewModelPiRuntime(patch.piRuntime);
            if (modelFormError) setModelFormError(null);
          }}
          onClose={handleCancelModelEdit}
          onSave={handleSaveNewModel}
        />

      </div>
    </Modal>
  );
};

export default Settings;
