import { useCallback, useEffect, useMemo, useState } from 'react';

import { type EnterpriseSessionResult, EnterpriseSessionStatus } from '../host-contract.js';
import {
  EnterpriseRendererLanguage,
  type EnterpriseRendererLanguage as EnterpriseRendererLanguageValue,
  EnterpriseRendererSurface,
} from '../renderer-contract.js';
import { LoginForm } from './components/session/LoginForm.js';
import { PasswordChangeForm } from './components/session/PasswordChangeForm.js';
import { SessionLayout } from './components/session/SessionLayout.js';
import { AccountSettingsUnavailable } from './components/settings/AccountSettings.js';
import { EnterpriseSettings } from './components/settings/EnterpriseSettings.js';
import { ManagedModels } from './components/settings/ManagedModels.js';
import { type TranslationKey, translate } from './i18n.js';
import { EnterpriseRendererClient } from './services/enterprise-renderer-client.js';
import { applyEnterpriseTheme } from './services/enterprise-theme.js';

interface RuntimeState {
  readonly language: EnterpriseRendererLanguageValue;
  readonly surface: EnterpriseRendererSurface;
  readonly pageId: string | null;
  readonly session: EnterpriseSessionResult;
}

export function App() {
  const client = useMemo(() => new EnterpriseRendererClient(), []);
  const [runtime, setRuntime] = useState<RuntimeState | null>(null);
  const [pending, setPending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [success, setSuccess] = useState<TranslationKey | null>(null);
  const loadModels = useCallback(() => client.listModels(), [client]);

  useEffect(
    () =>
      client.start(message => {
        applyEnterpriseTheme(message);
        document.documentElement.lang =
          message.language === EnterpriseRendererLanguage.Chinese ? 'zh-CN' : 'en';
        setRuntime({
          language: message.language,
          surface: message.surface,
          pageId: message.pageId,
          session: message.session,
        });
      }),
    [client],
  );

  if (!runtime) return null;

  const snapshot = runtime.session.ok ? runtime.session.snapshot : null;
  const passwordChangeRequired =
    snapshot?.status === EnterpriseSessionStatus.Authenticated &&
    snapshot.identity.passwordChangeRequired;

  const updateSession = (session: EnterpriseSessionResult) => {
    setRuntime(current => (current ? { ...current, session } : current));
  };

  const handleLogin = async (input: { aepBaseUrl: string; username: string; password: string }) => {
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await client.login(input);
      if (result.ok) {
        if (result.snapshot.status === EnterpriseSessionStatus.Authenticated) {
          updateSession(result);
        } else {
          setError('metadataUnavailable');
        }
      } else setError('loginFailed');
    } catch {
      setError('operationFailed');
    } finally {
      setPending(false);
    }
  };

  const handlePasswordChange = async (input: {
    currentPassword: string;
    newPassword: string;
  }): Promise<boolean> => {
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await client.changePassword(input);
      if (result.ok) {
        updateSession(result);
        if (runtime.surface === EnterpriseRendererSurface.Settings) {
          setSuccess('passwordChangeSucceeded');
        }
        return true;
      }
      setError('passwordChangeFailed');
    } catch {
      setError('operationFailed');
    } finally {
      setPending(false);
    }
    return false;
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await client.logout();
      if (result.ok) updateSession(result);
      else setError('operationFailed');
    } catch {
      setError('operationFailed');
    } finally {
      setSigningOut(false);
    }
  };

  if (runtime.surface === EnterpriseRendererSurface.Settings) {
    if (snapshot?.status !== EnterpriseSessionStatus.Authenticated) {
      return <AccountSettingsUnavailable language={runtime.language} />;
    }
    if (runtime.pageId === 'models') {
      return <ManagedModels language={runtime.language} loadModels={loadModels} />;
    }
    return (
      <EnterpriseSettings
        language={runtime.language}
        identity={snapshot.identity}
        pending={pending}
        signingOut={signingOut}
        error={error}
        success={success}
        onPasswordChange={handlePasswordChange}
        onSignOut={handleSignOut}
      />
    );
  }

  if (passwordChangeRequired) {
    return (
      <SessionLayout
        language={runtime.language}
        title={translate(runtime.language, 'passwordChangeTitle')}
        description={translate(runtime.language, 'passwordChangeDescription')}
      >
        <PasswordChangeForm
          language={runtime.language}
          pending={pending}
          signingOut={signingOut}
          error={error}
          success={null}
          onSubmit={handlePasswordChange}
          onSignOut={handleSignOut}
        />
      </SessionLayout>
    );
  }

  return (
    <SessionLayout
      language={runtime.language}
      title={translate(runtime.language, 'loginTitle')}
      description={translate(runtime.language, 'loginDescription')}
    >
      <LoginForm
        language={runtime.language}
        recoverable={snapshot?.status === EnterpriseSessionStatus.Recoverable}
        pending={pending}
        error={initialError(runtime.session, error)}
        onSubmit={handleLogin}
      />
    </SessionLayout>
  );
}

function initialError(
  session: EnterpriseSessionResult,
  current: TranslationKey | null,
): TranslationKey | null {
  return current ?? (session.ok ? null : 'operationFailed');
}
