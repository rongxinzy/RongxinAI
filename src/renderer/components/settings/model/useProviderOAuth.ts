import { useCallback, useEffect, useRef, useState } from 'react';

import { defaultConfig } from '../../../config';
import { configService } from '../../../services/config';
import { i18nService } from '../../../services/i18n';
import { apiFetch } from '../../../services/visibleApiTransport';
import {
  MINIMAX_BASE_URL_CN,
  MINIMAX_BASE_URL_GLOBAL,
  MINIMAX_CODE_ENDPOINT_CN,
  MINIMAX_CODE_ENDPOINT_GLOBAL,
  MINIMAX_OAUTH_CLIENT_ID,
  MINIMAX_OAUTH_GRANT_TYPE,
  MINIMAX_OAUTH_SCOPE,
  MINIMAX_TOKEN_ENDPOINT_CN,
  MINIMAX_TOKEN_ENDPOINT_GLOBAL,
  type CopilotAuthStatus,
  type MiniMaxOAuthPhase,
  type MiniMaxRegion,
  type OpenAIOAuthPhase,
  type OpenAIOAuthStatus,
  type ProvidersConfig,
  type ProviderType,
} from './constants';
import { generateMiniMaxPkce } from './providerUtils';

interface UseProviderOAuthParams {
  providers: ProvidersConfig;
  setProviders: React.Dispatch<React.SetStateAction<ProvidersConfig>>;
  activeProvider: ProviderType;
  handleProviderConfigChange: (provider: ProviderType, field: string, value: string) => void;
  enableProvider: (provider: ProviderType) => void;
  setError: (message: string | null) => void;
}

export function useProviderOAuth({
  providers,
  setProviders,
  activeProvider,
  handleProviderConfigChange,
  enableProvider,
  setError,
}: UseProviderOAuthParams) {
  // MiniMax OAuth state
  const [minimaxOAuthPhase, setMinimaxOAuthPhase] = useState<MiniMaxOAuthPhase>({ kind: 'idle' });
  const [minimaxOAuthRegion, setMinimaxOAuthRegion] = useState<MiniMaxRegion>('cn');
  const minimaxOAuthCancelRef = useRef(false);

  // OpenAI ChatGPT (Codex) OAuth state
  const [openaiOAuthPhase, setOpenaiOAuthPhase] = useState<OpenAIOAuthPhase>({ kind: 'idle' });
  // Mirrors <CODEX_HOME>/auth.json on disk; refreshed on tab focus and after
  // login/logout. `null` = not yet checked.
  const [openaiOAuthStatus, setOpenaiOAuthStatus] = useState<OpenAIOAuthStatus>(null);

  // GitHub Copilot device code auth state
  const [copilotAuthStatus, setCopilotAuthStatus] = useState<CopilotAuthStatus>('idle');
  const [copilotUserCode, setCopilotUserCode] = useState('');
  const [copilotVerificationUri, setCopilotVerificationUri] = useState('');
  const [copilotGithubUser, setCopilotGithubUser] = useState('');
  const [copilotError, setCopilotError] = useState<string | null>(null);

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

      const codeRes = await apiFetch({
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

        const tokenRes = await apiFetch({
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
  }, [activeProvider, setProviders]);

  const persistOpenAIProvidersConfigInBackground = useCallback(
    (nextProviders: ProvidersConfig) => {
      void configService.updateConfig({ providers: nextProviders }).catch(saveError => {
        console.error('[Settings] failed to save OpenAI OAuth provider state:', saveError);
        setError(i18nService.t('failedToSaveSettings'));
      });
    },
    [setError],
  );

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

  return {
    minimaxOAuthPhase,
    setMinimaxOAuthPhase,
    minimaxOAuthRegion,
    setMinimaxOAuthRegion,
    handleMiniMaxDeviceLogin,
    handleCancelMiniMaxLogin,
    handleMiniMaxOAuthLogout,
    openaiOAuthPhase,
    setOpenaiOAuthPhase,
    openaiOAuthStatus,
    handleOpenAIOAuthLogin,
    handleCancelOpenAIOAuthLogin,
    handleOpenAIOAuthLogout,
    copilotAuthStatus,
    copilotUserCode,
    copilotVerificationUri,
    copilotGithubUser,
    copilotError,
    handleCopilotSignIn,
    handleCopilotSignOut,
    handleCopilotCancelAuth,
  };
}
