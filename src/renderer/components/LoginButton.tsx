import { Button } from '@shared/components/ui/button';
import { LogIn, LogOut, Settings, UserRound } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { i18nService } from '../services/i18n';

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
  const [isStartingLogin, setIsStartingLogin] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshUser = useCallback(async () => {
    const result = await window.electron.auth.getCommunityUser();
    setUser(result.success && result.user ? result.user : null);
  }, []);

  useEffect(() => {
    void refreshUser();
    const unsubscribe = window.electron.auth.onCallback(callback => {
      if (callback.community) void refreshUser();
    });
    return unsubscribe;
  }, [refreshUser]);

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
      const result = await window.electron.auth.login();
      if (!result.success) setError(result.error || '无法开始登录，请稍后重试。');
      else setShowMenu(false);
    } finally {
      setIsStartingLogin(false);
    }
  };

  const handleLogout = async () => {
    await window.electron.auth.communityLogout();
    setUser(null);
    setShowMenu(false);
  };

  const handleSettings = () => {
    setShowMenu(false);
    onShowSettings();
  };

  const accountLabel = user?.email || i18nService.t('login');

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
        <UserRound className="size-4 shrink-0" />
        <span className="truncate">{accountLabel}</span>
      </Button>

      {showMenu ? (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-50 mb-2 w-60 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-popover"
        >
          {user ? (
            <>
              <div className="px-2.5 py-2 text-sm font-medium text-foreground">
                <p className="truncate">{user.email}</p>
                <p className="mt-0.5 text-xs font-normal text-muted-foreground">知远账号</p>
              </div>
              <div className="my-1 h-px bg-border" />
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              role="menuitem"
              disabled={isStartingLogin}
              onClick={() => void handleLogin()}
              className="h-9 w-full justify-start gap-2 rounded-lg px-2.5 text-sm"
            >
              <LogIn className="size-4" />
              {isStartingLogin ? '正在打开登录页…' : '登录知远'}
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            role="menuitem"
            onClick={handleSettings}
            className="h-9 w-full justify-start gap-2 rounded-lg px-2.5 text-sm"
          >
            <Settings className="size-4" />
            {i18nService.t('settings')}
          </Button>

          {user ? (
            <Button
              type="button"
              variant="ghost"
              role="menuitem"
              onClick={() => void handleLogout()}
              className="h-9 w-full justify-start gap-2 rounded-lg px-2.5 text-sm text-destructive hover:text-destructive"
            >
              <LogOut className="size-4" />
              退出登录
            </Button>
          ) : null}

          {error ? <p className="px-2.5 pb-1 pt-2 text-xs leading-5 text-destructive">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
};

export default LoginButton;
