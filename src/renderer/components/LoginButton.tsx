import { Button } from '@shared/components/ui/button';
import { Separator } from '@shared/components/ui/separator';
import { LogIn, LogOut, Settings, UserRound } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type {
  EnterpriseSessionIdentity,
  EnterpriseSessionResult,
} from '../../shared/enterpriseSession';
import {
  publishEnterpriseSessionResult,
  subscribeToEnterpriseSession,
} from '../services/enterpriseSessionEvents';
import { i18nService } from '../services/i18n';
import { ZhiyuanModelPoolEvent } from '../../shared/modelPool/constants';

interface CommunityUser {
  id: string;
  email: string;
}

interface LoginButtonProps {
  onShowSettings: () => void;
}

const LoginButton: React.FC<LoginButtonProps> = ({ onShowSettings }) => {
  const [showMenu, setShowMenu] = useState(false);
  const [user, setUser] = useState<CommunityUser | null>(null);
  const [enterpriseIdentity, setEnterpriseIdentity] = useState<EnterpriseSessionIdentity | null>(
    null,
  );
  const [isEnterpriseManaged, setIsEnterpriseManaged] = useState(false);
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshUser = useCallback(async () => {
    const result = await window.electron.auth.getCommunityUser();
    setUser(result.success && result.user ? result.user : null);
    window.dispatchEvent(new CustomEvent(ZhiyuanModelPoolEvent.AuthChanged));
  }, []);

  const applyEnterpriseSession = useCallback((result: EnterpriseSessionResult) => {
    setEnterpriseIdentity(
      result.ok && result.snapshot.status === 'authenticated' ? result.snapshot.identity : null,
    );
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribeCommunity: () => void = () => undefined;
    const unsubscribeEnterprise = subscribeToEnterpriseSession(result => {
      if (!active) return;
      setIsEnterpriseManaged(true);
      setUser(null);
      applyEnterpriseSession(result);
    });

    void window.electron.enterprise.renderer
      .sessionGateEntrypoint()
      .then(async entrypoint => {
        if (!active) return;
        if (entrypoint) {
          setIsEnterpriseManaged(true);
          setUser(null);
          applyEnterpriseSession(await window.electron.enterprise.session.snapshot());
          return;
        }

        setIsEnterpriseManaged(false);
        setEnterpriseIdentity(null);
        await refreshUser();
        if (!active) return;
        unsubscribeCommunity = window.electron.auth.onCommunityCallback(() => {
          void refreshUser();
        });
      })
      .catch(() => {
        if (!active) return;
        setIsEnterpriseManaged(false);
        void refreshUser();
      });

    return () => {
      active = false;
      unsubscribeCommunity();
      unsubscribeEnterprise();
    };
  }, [applyEnterpriseSession, refreshUser]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setShowMenu(false);
    };
    if (showMenu) document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showMenu]);

  const handleLogin = async () => {
    setError('');
    setIsStartingLogin(true);
    try {
      const result = await window.electron.auth.communityLogin();
      if (!result.success) setError(result.error || '无法开始登录，请稍后重试。');
      else setShowMenu(false);
    } finally {
      setIsStartingLogin(false);
    }
  };

  const handleLogout = async () => {
    if (isEnterpriseManaged) {
      const result = await window.electron.enterprise.session.logout();
      publishEnterpriseSessionResult(result);
      if (result.ok) {
        setEnterpriseIdentity(null);
        setShowMenu(false);
      } else {
        setError(i18nService.t('accountLogoutFailed'));
      }
      return;
    }
    await window.electron.auth.communityLogout();
    setUser(null);
    window.dispatchEvent(new CustomEvent(ZhiyuanModelPoolEvent.AuthChanged));
    setShowMenu(false);
  };

  const handleSettings = () => {
    setShowMenu(false);
    onShowSettings();
  };

  const accountLabel =
    enterpriseIdentity?.user.displayName ||
    (isEnterpriseManaged
      ? i18nService.t('enterpriseAccount')
      : user?.email || i18nService.t('login'));
  const hasAuthenticatedAccount = isEnterpriseManaged ? enterpriseIdentity !== null : user !== null;

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setShowMenu(open => !open)}
        aria-expanded={showMenu}
        aria-haspopup="menu"
        className="inline-flex h-8 w-full items-center justify-start gap-2 rounded-lg px-2 text-[14px] font-normal text-muted-foreground transition-colors hover:bg-black/3 dark:hover:bg-white/4"
      >
        <UserRound data-icon="inline-start" />
        <span className="truncate">{accountLabel}</span>
      </Button>

      {showMenu ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-popover"
        >
          {hasAuthenticatedAccount ? (
            <>
              <div className="px-2.5 py-2 text-sm font-medium text-foreground">
                <p className="truncate">{enterpriseIdentity?.user.displayName || user?.email}</p>
                <p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">
                  {enterpriseIdentity?.enterprise.name || i18nService.t('communityAccount')}
                </p>
              </div>
              <Separator className="my-1" />
            </>
          ) : !isEnterpriseManaged ? (
            <Button
              type="button"
              variant="ghost"
              role="menuitem"
              disabled={isStartingLogin}
              onClick={() => void handleLogin()}
              className="h-9 w-full justify-start gap-2 rounded-lg px-2.5 text-sm"
            >
              <LogIn data-icon="inline-start" />
              {isStartingLogin
                ? i18nService.t('accountOpeningLogin')
                : i18nService.t('accountLoginZhiyuan')}
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            role="menuitem"
            onClick={handleSettings}
            className="h-9 w-full justify-start gap-2 rounded-lg px-2.5 text-sm"
          >
            <Settings data-icon="inline-start" />
            {i18nService.t('settings')}
          </Button>

          {hasAuthenticatedAccount ? (
            <Button
              type="button"
              variant="ghost"
              role="menuitem"
              onClick={() => void handleLogout()}
              className="h-9 w-full justify-start gap-2 rounded-lg px-2.5 text-sm text-destructive hover:text-destructive"
            >
              <LogOut data-icon="inline-start" />
              {i18nService.t('accountLogout')}
            </Button>
          ) : null}

          {error ? (
            <p className="px-2.5 pb-1 pt-2 text-xs leading-5 text-destructive">{error}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default LoginButton;
