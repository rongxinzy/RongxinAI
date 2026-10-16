/**
 * Community auth bootstrap: zhiyuan:// deep-link registration, renderer log
 * forwarding, second-instance focus/deep-link handling and community OAuth
 * IPC (login/logout/user). The enterprise build never claims the protocol.
 */
import crypto from 'crypto';

import { app, ipcMain, net, shell } from 'electron';

import { isEnterprise } from './appEnv';
import { getStore } from './runtimeServices';
import { rt } from './runtimeState';
import { COMMUNITY_AUTH_ORIGIN, configureCommunityAuthSession } from '../communityAuthSession';
import { registerZhiyuanDeepLinkProtocol } from '../deepLinkRegistration';
import { registerModelPoolIpcHandlers } from '../modelPoolIpc';
import { CommunityAuthIpc } from '../../shared/ipc/channels';
import { getBranding } from '../../shared/branding';
import { t } from '../i18n';

type CommunityAuthSession = ReturnType<typeof configureCommunityAuthSession>;

let pendingCommunityLogin: { state: string; verifier: string; expiresAt: number } | null = null;
let communityAuthSession: CommunityAuthSession | null = null;

type CommunityAuthPayload = Record<string, unknown>;

async function readCommunityAuthPayload(response: Response): Promise<CommunityAuthPayload | null> {
  const rawText = await response.text();
  if (!rawText) return null;

  try {
    const payload: unknown = JSON.parse(rawText);
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as CommunityAuthPayload)
      : null;
  } catch {
    return null;
  }
}

/** Parse a zhiyuan:// deep link for the pending community login. */
export const handleDeepLink = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'auth' && parsed.pathname === '/callback') {
      const code = parsed.searchParams.get('code');
      const state = parsed.searchParams.get('state');
      if (code && state && pendingCommunityLogin?.state === state) {
        void completeCommunityLogin(code, state);
        return;
      }
      console.warn('[CommunityAuth] Ignoring unexpected auth callback');
    }
  } catch (e) {
    console.error('[Main] Failed to parse deep link:', e);
  }
};

export const registerCommunityAuthBootstrap = (): void => {
  // The enterprise build signs in inside the app and never claims zhiyuan://;
  // the community build owns it for its browser OAuth callback.
  registerZhiyuanDeepLinkProtocol(app, {
    isEnterpriseBuild: isEnterprise,
    isDefaultApp: process.defaultApp === true,
    entryPoint: process.argv[1],
    execPath: process.execPath,
  });

  ipcMain.on('log:fromRenderer', (_event, level: string, tag: string, message: string) => {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[Renderer][${tag}] ${message}`);
  });

  // macOS: handle open-url event for deep links
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    console.debug('[Main] second-instance event', { commandLine, workingDirectory });

    // Check for deep link in command line args (Windows/Linux)
    const deepLink = commandLine.find(arg => arg.startsWith('zhiyuan://'));
    if (deepLink) {
      handleDeepLink(deepLink);
    }

    // Focus main window
    if (rt.mainWindow) {
      if (rt.mainWindow.isMinimized()) rt.mainWindow.restore();
      if (!rt.mainWindow.isVisible()) rt.mainWindow.show();
      if (!rt.mainWindow.isFocused()) rt.mainWindow.focus();
    }
  });
};

async function completeCommunityLogin(code: string, state: string): Promise<void> {
  const pending = pendingCommunityLogin;
  pendingCommunityLogin = null;
  if (!pending || pending.state !== state || pending.expiresAt < Date.now()) return;
  try {
    const response = await net.fetch(`${COMMUNITY_AUTH_ORIGIN}/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: pending.verifier,
        redirect_uri: 'zhiyuan://auth/callback',
      }),
    });
    const payload = await readCommunityAuthPayload(response);
    if (!response.ok) {
      console.warn(
        `[CommunityAuth] token exchange returned an invalid response with status ${response.status}`,
      );
      throw new Error('Token exchange failed');
    }
    const user = communityAuthSession!.saveTokenPayload(payload);
    rt.mainWindow?.webContents.send(CommunityAuthIpc.Callback, {
      success: true,
      user: { id: user.id, email: user.email, name: user.email },
    });
    if (rt.mainWindow?.isMinimized()) rt.mainWindow.restore();
    if (rt.mainWindow && !rt.mainWindow.isVisible()) rt.mainWindow.show();
    rt.mainWindow?.focus();
  } catch (error) {
    console.warn(
      '[CommunityAuth] login callback failed:',
      error instanceof Error ? error.message : error,
    );
    rt.mainWindow?.webContents.send(CommunityAuthIpc.Callback, {
      success: false,
      error: t('communityAuthLoginIncomplete'),
    });
  }
}

export const registerCommunityAuthIpc = (): void => {
  communityAuthSession = configureCommunityAuthSession(getStore);
  if (getBranding().features.enableCommunityFreeModels) {
    registerModelPoolIpcHandlers(communityAuthSession);
  }

  ipcMain.handle(CommunityAuthIpc.GetCommunityUser, async () => {
    const user = communityAuthSession!.getUser();
    if (!user) return { success: false };
    try {
      await communityAuthSession!.getAccessToken();
      return { success: true, user };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle(CommunityAuthIpc.Logout, () => {
    communityAuthSession!.clear();
    return { success: true };
  });

  ipcMain.handle(CommunityAuthIpc.Login, async () => {
    try {
      if (!communityAuthSession!.canPersist()) {
        return { success: false, error: '系统安全存储不可用，无法安全地保存登录状态。' };
      }
      const verifier = crypto.randomBytes(48).toString('base64url');
      const state = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const response = await net.fetch(`${COMMUNITY_AUTH_ORIGIN}/v1/auth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uri: 'zhiyuan://auth/callback',
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        }),
      });
      const payload = await readCommunityAuthPayload(response);
      const loginUrl = typeof payload?.login_url === 'string' ? payload.login_url : null;
      if (!response.ok || !loginUrl || !loginUrl.startsWith(`${COMMUNITY_AUTH_ORIGIN}/`)) {
        console.warn(
          `[CommunityAuth] login initialization returned an invalid response with status ${response.status}`,
        );
        return { success: false, error: t('communityAuthServiceUnavailable') };
      }
      pendingCommunityLogin = { state, verifier, expiresAt: Date.now() + 10 * 60 * 1000 };
      await shell.openExternal(loginUrl);
      return { success: true };
    } catch (error) {
      console.error('[Auth] login failed:', error);
      return {
        success: false,
        error: t('communityAuthServiceUnavailable'),
      };
    }
  });
};
