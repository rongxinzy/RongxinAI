import { Button } from '@shared/components/ui/button';
import { Field, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@shared/components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';
import { ExternalLink, Eye, EyeOff, XCircle } from 'lucide-react';

import {
  ProviderName,
  ProviderRegistry,
  type DiscoveredProviderModel,
} from '../../../../shared/providers';
import { defaultConfig, getProviderDisplayName, isCustomProvider } from '../../../config';
import { i18nService } from '../../../services/i18n';
import type { ProviderModelRowActions } from '../ProviderModelRow';
import type { ModelConnectionStatus } from '../useModelConnectionStatus';
import type {
  CopilotAuthStatus,
  MiniMaxOAuthPhase,
  MiniMaxRegion,
  OpenAIOAuthPhase,
  OpenAIOAuthStatus,
  ProviderConfig,
  ProvidersConfig,
  ProviderType,
} from './constants';
import ProviderCodingPlanSection from './ProviderCodingPlanSection';
import ProviderModelsSection from './ProviderModelsSection';
import {
  CopilotAuthSection,
  MiniMaxOAuthSection,
  OpenAIOAuthSection,
} from './ProviderOAuthSections';
import {
  getCustomProviderLabel,
  getEffectiveApiFormat,
  getProviderDefaultBaseUrl,
  providerRequiresApiKey,
  shouldShowApiFormatSelector,
} from './providerUtils';

const CODING_PLAN_ENDPOINT_HINTS = [
  { provider: 'zhipu', label: 'GLM Coding Plan', hintKey: 'zhipuCodingPlanEndpointHint' },
  { provider: 'qwen', label: 'Coding Plan', hintKey: 'qwenCodingPlanEndpointHint' },
  { provider: 'volcengine', label: 'Coding Plan', hintKey: 'volcengineCodingPlanEndpointHint' },
  { provider: 'moonshot', label: 'Coding Plan', hintKey: 'moonshotCodingPlanEndpointHint' },
  { provider: 'qianfan', label: 'Coding Plan', hintKey: 'qianfanCodingPlanEndpointHint' },
  { provider: 'xiaomi', label: 'Coding Plan', hintKey: 'xiaomiCodingPlanEndpointHint' },
] as const satisfies ReadonlyArray<{
  provider: ProviderType;
  label: string;
  hintKey: string;
}>;

interface ProviderConfigColumnProps {
  providers: ProvidersConfig;
  setProviders: React.Dispatch<React.SetStateAction<ProvidersConfig>>;
  activeProvider: ProviderType;
  showApiKey: boolean;
  setShowApiKey: (show: boolean) => void;
  minimaxIsOAuthMode: boolean;
  openaiIsOAuthMode: boolean;
  isBaseUrlLocked: boolean;
  minimaxOAuthPhase: MiniMaxOAuthPhase;
  setMinimaxOAuthPhase: React.Dispatch<React.SetStateAction<MiniMaxOAuthPhase>>;
  minimaxOAuthRegion: MiniMaxRegion;
  setMinimaxOAuthRegion: (region: MiniMaxRegion) => void;
  onMiniMaxDeviceLogin: (region: MiniMaxRegion) => void;
  onCancelMiniMaxLogin: () => void;
  onMiniMaxOAuthLogout: () => void;
  openaiOAuthPhase: OpenAIOAuthPhase;
  setOpenaiOAuthPhase: React.Dispatch<React.SetStateAction<OpenAIOAuthPhase>>;
  openaiOAuthStatus: OpenAIOAuthStatus;
  onOpenAIOAuthLogin: () => void;
  onCancelOpenAIOAuthLogin: () => void;
  onOpenAIOAuthLogout: () => void;
  copilotAuthStatus: CopilotAuthStatus;
  copilotUserCode: string;
  copilotVerificationUri: string;
  copilotGithubUser: string;
  copilotError: string | null;
  onCopilotSignIn: () => void;
  onCopilotSignOut: () => void;
  onCopilotCancelAuth: () => void;
  autoDetectRequest: { provider: ProviderType; requestId: number } | null;
  isRefreshingLlamaCppModels: boolean;
  onRefreshLlamaCppModels: () => Promise<void>;
  onProviderConfigChange: (provider: ProviderType, field: string, value: string) => void;
  onApiKeyInputChange: (provider: ProviderType, value: string) => void;
  onBaseUrlInputChange: (provider: ProviderType, value: string) => void;
  onApiKeyBlur: (provider: ProviderType) => void;
  onBaseUrlBlur: (provider: ProviderType) => void;
  onRequestApiKeyClear: (provider: ProviderType) => void;
  onModelsDiscovered: (
    providerId: string,
    discoveredModels: readonly DiscoveredProviderModel[],
  ) => Promise<void>;
  onAddModel: () => void;
  getModelConnectionStatus: (provider: string, modelId: string) => ModelConnectionStatus;
  modelRowActions: ProviderModelRowActions;
}

export default function ProviderConfigColumn({
  providers,
  setProviders,
  activeProvider,
  showApiKey,
  setShowApiKey,
  minimaxIsOAuthMode,
  openaiIsOAuthMode,
  isBaseUrlLocked,
  minimaxOAuthPhase,
  setMinimaxOAuthPhase,
  minimaxOAuthRegion,
  setMinimaxOAuthRegion,
  onMiniMaxDeviceLogin,
  onCancelMiniMaxLogin,
  onMiniMaxOAuthLogout,
  openaiOAuthPhase,
  setOpenaiOAuthPhase,
  openaiOAuthStatus,
  onOpenAIOAuthLogin,
  onCancelOpenAIOAuthLogin,
  onOpenAIOAuthLogout,
  copilotAuthStatus,
  copilotUserCode,
  copilotVerificationUri,
  copilotGithubUser,
  copilotError,
  onCopilotSignIn,
  onCopilotSignOut,
  onCopilotCancelAuth,
  autoDetectRequest,
  isRefreshingLlamaCppModels,
  onRefreshLlamaCppModels,
  onProviderConfigChange,
  onApiKeyInputChange,
  onBaseUrlInputChange,
  onApiKeyBlur,
  onBaseUrlBlur,
  onRequestApiKeyClear,
  onModelsDiscovered,
  onAddModel,
  getModelConnectionStatus,
  modelRowActions,
}: ProviderConfigColumnProps) {
  return (
    <div className="min-h-0 w-full min-w-0 flex-1 space-y-4 overflow-y-auto pl-4 pr-2 scrollbar-gutter-stable md:w-3/5 md:flex-none">
      <div
        className={cn(
          'flex items-center pb-2 border-b border-border',
          isCustomProvider(activeProvider) && 'order-[-4]',
        )}
      >
        <div className="flex items-center gap-1.5">
          <h3 className="text-base font-semibold text-foreground">
            {isCustomProvider(activeProvider) ? (
              (providers[activeProvider] as ProviderConfig)?.displayName ||
              getCustomProviderLabel(activeProvider)
            ) : activeProvider === ProviderName.LlamaCpp ? (
              (ProviderRegistry.get(activeProvider)?.label ??
              getProviderDisplayName(activeProvider))
            ) : (
              <>
                {ProviderRegistry.get(activeProvider)?.label ??
                  getProviderDisplayName(activeProvider)}{' '}
                {i18nService.t('providerSettings')}
              </>
            )}
          </h3>
          {activeProvider !== ProviderName.LlamaCpp &&
            ProviderRegistry.get(activeProvider)?.website && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  void window.electron.shell.openExternal(
                    ProviderRegistry.get(activeProvider)!.website!,
                  )
                }
                className="theme-action-muted-accent"
                title={i18nService.t('visitOfficialSite')}
                aria-label={i18nService.t('visitOfficialSite')}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
        </div>
      </div>

      {/* MiniMax OAuth auth section */}
      {activeProvider === 'minimax' && (
        <MiniMaxOAuthSection
          providers={providers}
          setProviders={setProviders}
          minimaxIsOAuthMode={minimaxIsOAuthMode}
          minimaxOAuthPhase={minimaxOAuthPhase}
          setMinimaxOAuthPhase={setMinimaxOAuthPhase}
          minimaxOAuthRegion={minimaxOAuthRegion}
          setMinimaxOAuthRegion={setMinimaxOAuthRegion}
          showApiKey={showApiKey}
          setShowApiKey={setShowApiKey}
          onProviderConfigChange={onProviderConfigChange}
          onRequestApiKeyClear={onRequestApiKeyClear}
          onMiniMaxDeviceLogin={onMiniMaxDeviceLogin}
          onCancelMiniMaxLogin={onCancelMiniMaxLogin}
          onMiniMaxOAuthLogout={onMiniMaxOAuthLogout}
        />
      )}

      {/* OpenAI ChatGPT (Codex) OAuth auth section */}
      {activeProvider === 'openai' && (
        <OpenAIOAuthSection
          setProviders={setProviders}
          openaiIsOAuthMode={openaiIsOAuthMode}
          openaiOAuthPhase={openaiOAuthPhase}
          setOpenaiOAuthPhase={setOpenaiOAuthPhase}
          openaiOAuthStatus={openaiOAuthStatus}
          onOpenAIOAuthLogin={onOpenAIOAuthLogin}
          onCancelOpenAIOAuthLogin={onCancelOpenAIOAuthLogin}
          onOpenAIOAuthLogout={onOpenAIOAuthLogout}
        />
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
                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor={`${activeProvider}-apiKey`}>
                      {i18nService.t('apiKey')}
                      {providerRequiresApiKey(activeProvider) && (
                        <span className="text-destructive">*</span>
                      )}
                    </FieldLabel>
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
                        className="theme-action-inline-link"
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
                      onChange={e => onApiKeyInputChange(activeProvider, e.target.value)}
                      onBlur={() => onApiKeyBlur(activeProvider)}
                      className="theme-control-sizing-3 theme-control-small-text"
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
                              onClick={() => onRequestApiKeyClear(activeProvider)}
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
                </Field>
              )}

              {/* Qwen API Key section */}
              {activeProvider === 'qwen' && (
                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="qwen-apiKey">
                      API Key<span className="text-destructive">*</span>
                    </FieldLabel>
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
                        className="theme-action-inline-link"
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
                      onChange={e => onApiKeyInputChange('qwen', e.target.value)}
                      onBlur={() => onApiKeyBlur('qwen')}
                      className="theme-control-sizing-3 theme-control-small-text"
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
                              onClick={() => onRequestApiKeyClear('qwen')}
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
                </Field>
              )}
            </div>
          )}

        {activeProvider === 'github-copilot' && (
          <CopilotAuthSection
            providers={providers}
            copilotAuthStatus={copilotAuthStatus}
            copilotUserCode={copilotUserCode}
            copilotVerificationUri={copilotVerificationUri}
            copilotGithubUser={copilotGithubUser}
            copilotError={copilotError}
            onCopilotSignIn={onCopilotSignIn}
            onCopilotSignOut={onCopilotSignOut}
            onCopilotCancelAuth={onCopilotCancelAuth}
          />
        )}

        {isCustomProvider(activeProvider) && (
          <Field className="order-[-1]">
            <FieldLabel htmlFor={`${activeProvider}-displayName`}>
              {i18nService.t('customDisplayName')}
            </FieldLabel>
            <Input
              type="text"
              id={`${activeProvider}-displayName`}
              value={(providers[activeProvider] as ProviderConfig)?.displayName ?? ''}
              onChange={e => onProviderConfigChange(activeProvider, 'displayName', e.target.value)}
              className="theme-page-settings-input-1"
              placeholder={i18nService.t('customDisplayNamePlaceholder')}
            />
          </Field>
        )}

        {activeProvider !== ProviderName.LlamaCpp &&
          !(activeProvider === 'minimax' && minimaxIsOAuthMode) && (
            <Field className={isCustomProvider(activeProvider) ? 'order-[-3]' : 'order-1'}>
              <FieldLabel htmlFor={`${activeProvider}-baseUrl`}>
                {i18nService.t('baseUrl')}
                {isCustomProvider(activeProvider) && <span className="text-destructive">*</span>}
              </FieldLabel>
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
                      const cpUrl = (providers[activeProvider] as { codingPlanEnabled?: boolean })
                        .codingPlanEnabled
                        ? ProviderRegistry.getCodingPlanUrl(activeProvider, fmt)
                        : undefined;
                      if (cpUrl) return cpUrl;
                    }
                    return providers[activeProvider].baseUrl;
                  })()}
                  onChange={e => onBaseUrlInputChange(activeProvider, e.target.value)}
                  onBlur={() => onBaseUrlBlur(activeProvider)}
                  disabled={isBaseUrlLocked}
                  className={cn(
                    'theme-page-settings-input-variant-1',
                    'theme-page-settings-input-variant-2',
                    isBaseUrlLocked && 'theme-page-settings-input-variant-3 cursor-not-allowed',
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
                            onClick={() => onProviderConfigChange(activeProvider, 'baseUrl', '')}
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
              {/* Coding Plan 端点提示 */}
              {CODING_PLAN_ENDPOINT_HINTS.filter(
                hint =>
                  hint.provider === activeProvider && providers[hint.provider].codingPlanEnabled,
              ).map(hint => (
                <div
                  key={hint.provider}
                  className="mt-1.5 rounded-lg border border-border bg-primary-muted p-2"
                >
                  <p className="text-xs text-primary">
                    <span className="font-medium">{hint.label}:</span> {i18nService.t(hint.hintKey)}
                  </p>
                </div>
              ))}
            </Field>
          )}

        {/* API 格式选择器 */}
        {shouldShowApiFormatSelector(activeProvider) &&
          activeProvider !== ProviderName.LlamaCpp &&
          !(activeProvider === 'minimax' && minimaxIsOAuthMode) && (
            <Field className={isCustomProvider(activeProvider) ? undefined : 'order-3'}>
              <FieldLabel htmlFor={`${activeProvider}-apiFormat`}>
                {i18nService.t('apiFormat')}
              </FieldLabel>
              <div className="flex items-center space-x-4">
                <RadioGroup
                  value={
                    getEffectiveApiFormat(activeProvider, providers[activeProvider].apiFormat) ===
                    'openai'
                      ? 'openai'
                      : 'anthropic'
                  }
                  onValueChange={value =>
                    onProviderConfigChange(activeProvider, 'apiFormat', value)
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
                    <RadioGroupItem value="openai" id={`${activeProvider}-apiFormat-openai`} />
                    <label
                      htmlFor={`${activeProvider}-apiFormat-openai`}
                      className="text-sm text-foreground"
                    >
                      {i18nService.t('apiFormatOpenAI')}
                    </label>
                  </div>
                </RadioGroup>
              </div>
            </Field>
          )}
      </div>

      <ProviderCodingPlanSection
        providers={providers}
        activeProvider={activeProvider}
        onProviderConfigChange={onProviderConfigChange}
      />

      <ProviderModelsSection
        providers={providers}
        activeProvider={activeProvider}
        autoDetectRequest={autoDetectRequest}
        isRefreshingLlamaCppModels={isRefreshingLlamaCppModels}
        onRefreshLlamaCppModels={onRefreshLlamaCppModels}
        onModelsDiscovered={onModelsDiscovered}
        onAddModel={onAddModel}
        getModelConnectionStatus={getModelConnectionStatus}
        modelRowActions={modelRowActions}
      />
    </div>
  );
}
