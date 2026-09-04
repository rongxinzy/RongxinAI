import { net, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';

export const COMMUNITY_AUTH_ORIGIN = 'https://account.rongxzyai.com';

const COMMUNITY_AUTH_SESSION_KEY = 'community_auth_session_v1';
const COMMUNITY_GUEST_INSTALLATION_KEY = 'community_guest_installation_v1';
const COMMUNITY_AUTH_SESSION_VERSION = 2;
const ACCESS_TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;

export interface CommunityAuthUser {
  id: string;
  email: string;
}

interface CommunityAuthSession {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  user: CommunityAuthUser;
}

interface CommunityAuthStore {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
}

interface StoredCommunityAuthSession {
  version?: unknown;
  encrypted?: unknown;
}

interface CommunityAuthTokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user?: unknown;
}

interface GuestAccessToken {
  accessToken: string;
  accessTokenExpiresAt: number;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseResponsePayload(value: unknown): CommunityAuthTokenPayload | null {
  return toRecord(value) as CommunityAuthTokenPayload | null;
}

async function readResponsePayload(response: Response): Promise<CommunityAuthTokenPayload | null> {
  const rawText = await response.text();
  if (!rawText) return null;
  try {
    return parseResponsePayload(JSON.parse(rawText) as unknown);
  } catch {
    return null;
  }
}

function parseJwtExpiry(accessToken: string): number | null {
  const encodedPayload = accessToken.split('.')[1];
  if (!encodedPayload) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof payload.exp === 'number' && Number.isSafeInteger(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

function parseSession(value: unknown): CommunityAuthSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const session = value as Partial<CommunityAuthSession>;
  if (
    typeof session.accessToken !== 'string' ||
    !session.accessToken ||
    typeof session.refreshToken !== 'string' ||
    !session.refreshToken ||
    !session.user ||
    typeof session.user.id !== 'string' ||
    !session.user.id ||
    typeof session.user.email !== 'string' ||
    !session.user.email
  )
    return null;

  const accessTokenExpiresAt =
    typeof session.accessTokenExpiresAt === 'number' &&
    Number.isSafeInteger(session.accessTokenExpiresAt)
      ? session.accessTokenExpiresAt
      : (parseJwtExpiry(session.accessToken) ?? 0);
  return {
    accessToken: session.accessToken,
    accessTokenExpiresAt,
    refreshToken: session.refreshToken,
    user: session.user,
  };
}

function parseTokenPayload(
  payload: CommunityAuthTokenPayload | null,
  now: number,
): CommunityAuthSession | null {
  if (!payload) return null;
  const user = toRecord(payload.user);
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : '';
  const expiresIn =
    typeof payload.expires_in === 'number' && Number.isSafeInteger(payload.expires_in)
      ? payload.expires_in
      : 0;
  const userId = typeof user?.id === 'string' ? user.id : '';
  const userEmail = typeof user?.email === 'string' ? user.email : '';
  if (!accessToken || !refreshToken || !userId || !userEmail || expiresIn <= 0) return null;
  return {
    accessToken,
    accessTokenExpiresAt: now + expiresIn * 1000,
    refreshToken,
    user: { id: userId, email: userEmail },
  };
}

function parseGuestTokenPayload(
  payload: CommunityAuthTokenPayload | null,
  now: number,
): GuestAccessToken | null {
  if (!payload) return null;
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
  const expiresIn =
    typeof payload.expires_in === 'number' && Number.isSafeInteger(payload.expires_in)
      ? payload.expires_in
      : 0;
  if (!accessToken || expiresIn <= 0) return null;
  return {
    accessToken,
    accessTokenExpiresAt: now + expiresIn * 1000,
  };
}

export class CommunityAuthSessionManager {
  private refreshPromise: Promise<CommunityAuthSession> | null = null;
  private guestToken: GuestAccessToken | null = null;
  private guestTokenPromise: Promise<GuestAccessToken> | null = null;

  constructor(private readonly getStore: () => CommunityAuthStore) {}

  canPersist(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
  }

  saveTokenPayload(payload: unknown, now = Date.now()): CommunityAuthUser {
    const session = parseTokenPayload(parseResponsePayload(payload), now);
    if (!session) throw new Error('Community authentication returned an invalid token response.');
    this.saveSession(session);
    return session.user;
  }

  getUser(): CommunityAuthUser | null {
    return this.readSession()?.user ?? null;
  }

  clear(): void {
    this.getStore().delete(COMMUNITY_AUTH_SESSION_KEY);
  }

  async getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
    const session = this.readSession();
    if (!session) throw new Error('ZhiYuan account login is required.');
    if (
      !options.forceRefresh &&
      session.accessTokenExpiresAt > Date.now() + ACCESS_TOKEN_REFRESH_WINDOW_MS
    ) {
      return session.accessToken;
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshSession(session).finally(() => {
        this.refreshPromise = null;
      });
    }
    return (await this.refreshPromise).accessToken;
  }

  async getModelPoolAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
    if (this.getUser()) return this.getAccessToken(options);
    if (
      !options.forceRefresh &&
      this.guestToken &&
      this.guestToken.accessTokenExpiresAt > Date.now() + ACCESS_TOKEN_REFRESH_WINDOW_MS
    ) {
      return this.guestToken.accessToken;
    }

    if (!this.guestTokenPromise) {
      this.guestTokenPromise = this.issueGuestToken().finally(() => {
        this.guestTokenPromise = null;
      });
    }
    return (await this.guestTokenPromise).accessToken;
  }

  private saveSession(session: CommunityAuthSession): void {
    if (!this.canPersist()) {
      throw new Error(
        'System secure storage is unavailable; the login session cannot be saved safely.',
      );
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(session)).toString('base64');
    this.getStore().set(COMMUNITY_AUTH_SESSION_KEY, {
      version: COMMUNITY_AUTH_SESSION_VERSION,
      encrypted,
    });
  }

  private readSession(): CommunityAuthSession | null {
    const stored = this.getStore().get<StoredCommunityAuthSession>(COMMUNITY_AUTH_SESSION_KEY);
    if (
      (stored?.version !== 1 && stored?.version !== COMMUNITY_AUTH_SESSION_VERSION) ||
      typeof stored.encrypted !== 'string' ||
      !this.canPersist()
    )
      return null;
    try {
      const session = parseSession(
        JSON.parse(safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64'))) as unknown,
      );
      if (!session) throw new Error('invalid session');
      return session;
    } catch {
      this.clear();
      return null;
    }
  }

  private async refreshSession(session: CommunityAuthSession): Promise<CommunityAuthSession> {
    const response = await net.fetch(`${COMMUNITY_AUTH_ORIGIN}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
      }),
    });
    const refreshed = parseTokenPayload(await readResponsePayload(response), Date.now());
    if (!response.ok || !refreshed) {
      if (response.status === 400 || response.status === 401) this.clear();
      throw new Error(`ZhiYuan account token refresh failed with status ${response.status}.`);
    }
    this.saveSession(refreshed);
    return refreshed;
  }

  private getGuestInstallationId(): string {
    const stored = this.getStore().get<unknown>(COMMUNITY_GUEST_INSTALLATION_KEY);
    if (typeof stored === 'string' && /^[0-9a-f-]{36}$/iu.test(stored)) return stored;
    const installationId = randomUUID();
    this.getStore().set(COMMUNITY_GUEST_INSTALLATION_KEY, installationId);
    return installationId;
  }

  private async issueGuestToken(): Promise<GuestAccessToken> {
    const response = await net.fetch(`${COMMUNITY_AUTH_ORIGIN}/v1/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installation_id: this.getGuestInstallationId() }),
    });
    const token = parseGuestTokenPayload(await readResponsePayload(response), Date.now());
    if (!response.ok || !token) {
      throw new Error(`ZhiYuan guest token request failed with status ${response.status}.`);
    }
    this.guestToken = token;
    return token;
  }
}

let configuredSessionManager: CommunityAuthSessionManager | null = null;

export function configureCommunityAuthSession(
  getStore: () => CommunityAuthStore,
): CommunityAuthSessionManager {
  configuredSessionManager = new CommunityAuthSessionManager(getStore);
  return configuredSessionManager;
}

export function getCommunityAuthAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  if (!configuredSessionManager) throw new Error('Community authentication is not initialized.');
  return configuredSessionManager.getAccessToken(options);
}

export function getModelPoolAccessToken(options?: { forceRefresh?: boolean }): Promise<string> {
  if (!configuredSessionManager) throw new Error('Community authentication is not initialized.');
  return configuredSessionManager.getModelPoolAccessToken(options);
}
