import { Button } from '@shared/components/ui/button';
import { FieldLabel, FieldTitle } from '@shared/components/ui/field';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Input } from '@shared/components/ui/input';
import { Spinner } from '@shared/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { Eye, EyeOff, Key, ShieldCheck, XCircle } from 'lucide-react';

import { ProviderRegistry } from '../../../../shared/providers';
import { i18nService } from '../../../services/i18n';
import { GitHubCopilotIcon } from '../../icons/providers';
import type {
  CopilotAuthStatus,
  MiniMaxOAuthPhase,
  MiniMaxRegion,
  OpenAIOAuthPhase,
  OpenAIOAuthStatus,
  ProvidersConfig,
  ProviderType,
} from './constants';

interface MiniMaxOAuthSectionProps {
  providers: ProvidersConfig;
  setProviders: React.Dispatch<React.SetStateAction<ProvidersConfig>>;
  minimaxIsOAuthMode: boolean;
  minimaxOAuthPhase: MiniMaxOAuthPhase;
  setMinimaxOAuthPhase: React.Dispatch<React.SetStateAction<MiniMaxOAuthPhase>>;
  minimaxOAuthRegion: MiniMaxRegion;
  setMinimaxOAuthRegion: (region: MiniMaxRegion) => void;
  showApiKey: boolean;
  setShowApiKey: (show: boolean) => void;
  onProviderConfigChange: (provider: ProviderType, field: string, value: string) => void;
  onRequestApiKeyClear: (provider: ProviderType) => void;
  onMiniMaxDeviceLogin: (region: MiniMaxRegion) => void;
  onCancelMiniMaxLogin: () => void;
  onMiniMaxOAuthLogout: () => void;
}

export function MiniMaxOAuthSection({
  providers,
  setProviders,
  minimaxIsOAuthMode,
  minimaxOAuthPhase,
  setMinimaxOAuthPhase,
  minimaxOAuthRegion,
  setMinimaxOAuthRegion,
  showApiKey,
  setShowApiKey,
  onProviderConfigChange,
  onRequestApiKeyClear,
  onMiniMaxDeviceLogin,
  onCancelMiniMaxLogin,
  onMiniMaxOAuthLogout,
}: MiniMaxOAuthSectionProps) {
  return (
    <div className="space-y-4">
      {/* Auth type radio cards */}
      <div>
        <FieldTitle className="mb-2">{i18nService.t('minimaxAuthMethodLabel')}</FieldTitle>
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
                  enabled: prev.minimax.enabled && prev.minimax.apiKey.trim().length > 0,
                },
              }));
              setMinimaxOAuthPhase({ kind: 'idle' });
            }}
            aria-pressed={!minimaxIsOAuthMode}
            className="theme-auth-choice flex-1 text-left"
          >
            <div className="flex items-center justify-center gap-2">
              <Key className="h-4 w-4 text-foreground shrink-0" />
              <p className="text-sm font-medium text-foreground">
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
                    prev.minimax.enabled && (prev.minimax.oauthAccessToken?.trim().length ?? 0) > 0,
                },
              }))
            }
            aria-pressed={minimaxIsOAuthMode}
            className="theme-auth-choice flex-1 text-left"
          >
            <div className="flex items-center justify-center gap-2">
              <ShieldCheck className="h-4 w-4 text-foreground shrink-0" />
              <p className="text-sm font-medium text-foreground">
                {i18nService.t('minimaxOAuthTabOAuth')}
              </p>
            </div>
          </Button>
        </div>
      </div>

      {/* API Key mode */}
      {!minimaxIsOAuthMode && (
        <div className="min-h-17">
          <div className="flex items-center justify-between mb-1">
            <FieldLabel htmlFor="minimax-apiKey">
              {i18nService.t('apiKey')}
              <span className="text-destructive">*</span>
            </FieldLabel>
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
                className="theme-action-inline-link"
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
              onChange={e => onProviderConfigChange('minimax', 'apiKey', e.target.value)}
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
                  {showApiKey ? i18nService.t('hide') || 'Hide' : i18nService.t('show') || 'Show'}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onRequestApiKeyClear('minimax')}
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
        <div className="space-y-2 min-h-17">
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
                  onClick={() => onMiniMaxDeviceLogin(minimaxOAuthRegion)}
                  className="theme-action-compact"
                >
                  {i18nService.t('minimaxOAuthRelogin')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onMiniMaxOAuthLogout}
                  className="theme-action-compact-danger"
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
                <FieldTitle className="mb-1">{i18nService.t('minimaxOAuthRegionLabel')}</FieldTitle>
                <FluidTabs<MiniMaxRegion>
                  aria-label={i18nService.t('minimaxOAuthRegionLabel')}
                  items={[
                    { value: 'cn', label: i18nService.t('minimaxOAuthRegionCN') },
                    {
                      value: 'global',
                      label: i18nService.t('minimaxOAuthRegionGlobal'),
                    },
                  ]}
                  value={minimaxOAuthRegion}
                  onValueChange={setMinimaxOAuthRegion}
                />
              </div>
              <Button
                type="button"
                onClick={() => onMiniMaxDeviceLogin(minimaxOAuthRegion)}
                className="theme-page-settings-button-3 w-full"
              >
                {i18nService.t('minimaxOAuthLogin')}
              </Button>
              <p className="text-xs text-muted-foreground">{i18nService.t('minimaxOAuthHint')}</p>
            </div>
          )}

          {/* Requesting code */}
          {minimaxOAuthPhase.kind === 'requesting_code' && (
            <div className="p-3 rounded-xl bg-surface-raised border border-border">
              <p className="text-xs text-muted-foreground">
                {i18nService.t('minimaxOAuthLoggingIn')}
              </p>
            </div>
          )}

          {/* Pending — show user code */}
          {minimaxOAuthPhase.kind === 'pending' && (
            <div className="p-3 rounded-xl bg-surface-raised border border-border space-y-2">
              <p className="text-xs text-foreground font-medium">
                {i18nService.t('minimaxOAuthOpenBrowserHint')}
              </p>
              <div>
                <span className="text-xs text-muted-foreground">
                  {i18nService.t('minimaxOAuthUserCode')}:&nbsp;
                </span>
                <code className="text-xs font-mono text-primary">{minimaxOAuthPhase.userCode}</code>
              </div>
              <a
                href={minimaxOAuthPhase.verificationUri}
                onClick={e => {
                  e.preventDefault();
                  void window.electron.shell.openExternal(minimaxOAuthPhase.verificationUri);
                }}
                className="theme-surface-provider-link block truncate"
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
                onClick={onCancelMiniMaxLogin}
                className="theme-action-compact"
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
              <p className="text-xs text-destructive wrap-break-word">
                {minimaxOAuthPhase.message}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onMiniMaxDeviceLogin(minimaxOAuthRegion)}
                  className="theme-action-compact"
                >
                  {i18nService.t('minimaxOAuthRelogin')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMinimaxOAuthPhase({ kind: 'idle' })}
                  className="theme-action-compact"
                >
                  {i18nService.t('minimaxOAuthCancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface OpenAIOAuthSectionProps {
  setProviders: React.Dispatch<React.SetStateAction<ProvidersConfig>>;
  openaiIsOAuthMode: boolean;
  openaiOAuthPhase: OpenAIOAuthPhase;
  setOpenaiOAuthPhase: React.Dispatch<React.SetStateAction<OpenAIOAuthPhase>>;
  openaiOAuthStatus: OpenAIOAuthStatus;
  onOpenAIOAuthLogin: () => void;
  onCancelOpenAIOAuthLogin: () => void;
  onOpenAIOAuthLogout: () => void;
}

export function OpenAIOAuthSection({
  setProviders,
  openaiIsOAuthMode,
  openaiOAuthPhase,
  setOpenaiOAuthPhase,
  openaiOAuthStatus,
  onOpenAIOAuthLogin,
  onCancelOpenAIOAuthLogin,
  onOpenAIOAuthLogout,
}: OpenAIOAuthSectionProps) {
  return (
    <div className="space-y-4">
      {/* Auth type radio cards */}
      <div>
        <FieldTitle className="mb-2">{i18nService.t('openaiAuthMethodLabel')}</FieldTitle>
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
            aria-pressed={!openaiIsOAuthMode}
            className="theme-auth-choice flex-1 text-left"
          >
            <div className="flex items-center justify-center gap-2">
              <Key className="h-4 w-4 text-foreground shrink-0" />
              <p className="text-sm font-medium text-foreground">
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
            aria-pressed={openaiIsOAuthMode}
            className="theme-auth-choice flex-1 text-left"
          >
            <div className="flex items-center justify-center gap-2">
              <ShieldCheck className="h-4 w-4 text-foreground shrink-0" />
              <p className="text-sm font-medium text-foreground">
                {i18nService.t('openaiOAuthTabOAuth')}
              </p>
            </div>
          </Button>
        </div>
      </div>

      {/* OAuth mode UI */}
      {openaiIsOAuthMode && (
        <div className="space-y-2 min-h-17">
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
                  onClick={onOpenAIOAuthLogin}
                  className="theme-action-compact"
                >
                  {i18nService.t('openaiOAuthRelogin')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void onOpenAIOAuthLogout();
                  }}
                  className="theme-action-compact-danger"
                >
                  {i18nService.t('openaiOAuthLogout')}
                </Button>
              </div>
            </div>
          )}

          {/* Idle + not logged in — show login CTA */}
          {openaiOAuthPhase.kind === 'idle' && openaiOAuthStatus && !openaiOAuthStatus.loggedIn && (
            <div className="space-y-2">
              <Button
                type="button"
                onClick={onOpenAIOAuthLogin}
                className="theme-page-settings-button-4 w-full"
              >
                {i18nService.t('openaiOAuthLogin')}
              </Button>
              <p className="text-xs text-muted-foreground">{i18nService.t('openaiOAuthHint')}</p>
            </div>
          )}

          {/* Pending — browser opened, waiting for callback */}
          {openaiOAuthPhase.kind === 'pending' && (
            <div className="p-3 rounded-xl bg-surface-raised border border-border space-y-2">
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
                  void onCancelOpenAIOAuthLogin();
                }}
                className="theme-action-compact"
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
              <p className="text-xs text-destructive wrap-break-word">{openaiOAuthPhase.message}</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={onOpenAIOAuthLogin}
                  className="theme-action-compact"
                >
                  {i18nService.t('openaiOAuthRelogin')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpenaiOAuthPhase({ kind: 'idle' })}
                  className="theme-action-compact"
                >
                  {i18nService.t('openaiOAuthCancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface CopilotAuthSectionProps {
  providers: ProvidersConfig;
  copilotAuthStatus: CopilotAuthStatus;
  copilotUserCode: string;
  copilotVerificationUri: string;
  copilotGithubUser: string;
  copilotError: string | null;
  onCopilotSignIn: () => void;
  onCopilotSignOut: () => void;
  onCopilotCancelAuth: () => void;
}

export function CopilotAuthSection({
  providers,
  copilotAuthStatus,
  copilotUserCode,
  copilotVerificationUri,
  copilotGithubUser,
  copilotError,
  onCopilotSignIn,
  onCopilotSignOut,
  onCopilotCancelAuth,
}: CopilotAuthSectionProps) {
  return (
    <div className="order-2">
      <FieldTitle className="mb-2">{i18nService.t('githubCopilotAuth')}</FieldTitle>

      {(copilotAuthStatus === 'idle' || copilotAuthStatus === 'error') &&
        !providers['github-copilot'].apiKey && (
          <div className="space-y-2">
            <Button
              type="button"
              onClick={onCopilotSignIn}
              className="theme-page-settings-button-5 flex items-center"
            >
              <GitHubCopilotIcon className="w-4 h-4" />
              {i18nService.t('githubCopilotSignIn')}
            </Button>
            {copilotError && <p className="text-xs text-destructive">{copilotError}</p>}
          </div>
        )}

      {copilotAuthStatus === 'requesting' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
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
              <code className="text-lg font-mono font-semibold tracking-widest text-foreground">
                {copilotUserCode}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(copilotUserCode);
                }}
                className="theme-page-settings-button-6"
              >
                {i18nService.t('copy') || 'Copy'}
              </Button>
            </div>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => window.electron.shell.openExternal(copilotVerificationUri)}
              className="theme-page-settings-button-7 mt-2"
            >
              {copilotVerificationUri}
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="h-3 w-3" />
              {i18nService.t('githubCopilotWaiting')}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCopilotCancelAuth}
              className="theme-action-inline-danger"
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
              onClick={onCopilotSignOut}
              className="theme-action-inline-danger"
            >
              {i18nService.t('githubCopilotSignOut')}
            </Button>
          </div>
        )}
    </div>
  );
}
