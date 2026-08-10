import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { session, shell } from 'electron';
import http from 'http';

import type { SqliteStore } from '../sqliteStore';

export const MCP_OAUTH_STORE_PREFIX = 'mcp.oauth.';
const MCP_OAUTH_REQUEST_TIMEOUT_MS = 30_000;
const MCP_OAUTH_TOTAL_TIMEOUT_MS = 60_000;
const MCP_OAUTH_CALLBACK_PORT_BASE = 18_000;
const MCP_OAUTH_CALLBACK_PORT_RANGE = 10_000;
const MCP_OAUTH_CALLBACK_PORT_ATTEMPTS = 32;
const MCP_OAUTH_CALLBACK_PATH = '/mcp-oauth/callback';

function getMcpOAuthCallbackPort(serverId: string, offset = 0): number {
  let hash = 0;
  for (const character of serverId) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return (
    MCP_OAUTH_CALLBACK_PORT_BASE +
    ((hash >>> 0) + offset) % MCP_OAUTH_CALLBACK_PORT_RANGE
  );
}

function getStoredOAuthCallbackPort(store: SqliteStore, serverId: string): number | undefined {
  const storedRedirectUri = store.get<OAuthSession>(`${MCP_OAUTH_STORE_PREFIX}${serverId}`)?.clientRedirectUri;
  if (!storedRedirectUri) return undefined;
  try {
    const redirectUrl = new URL(storedRedirectUri);
    const callbackPort = Number(redirectUrl.port);
    if (
      redirectUrl.hostname !== '127.0.0.1' ||
      redirectUrl.pathname !== MCP_OAUTH_CALLBACK_PATH ||
      !Number.isInteger(callbackPort)
    ) {
      return undefined;
    }
    return callbackPort;
  } catch {
    return undefined;
  }
}

async function createOAuthCallbackServer(
  serverId: string,
  preferredPort?: number,
): Promise<{
  callbackPort: number;
  callbackServer: http.Server;
}> {
  const attemptedPorts = new Set<number>();
  for (let attempt = 0; attempt < MCP_OAUTH_CALLBACK_PORT_ATTEMPTS; attempt += 1) {
    const callbackPort =
      attempt === 0 && preferredPort !== undefined
        ? preferredPort
        : getMcpOAuthCallbackPort(serverId, preferredPort === undefined ? attempt : attempt - 1);
    if (attemptedPorts.has(callbackPort)) continue;
    attemptedPorts.add(callbackPort);
    const callbackServer = http.createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        callbackServer.once('error', reject);
        callbackServer.listen(callbackPort, '127.0.0.1', () => resolve());
      });
      return { callbackPort, callbackServer };
    } catch (error) {
      callbackServer.close();
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No available local port for MCP OAuth callback');
}

const electronFetch = (input: string | URL, init?: RequestInit): Promise<Response> =>
  session.defaultSession.fetch(typeof input === 'string' ? input : input.toString(), init) as unknown as Promise<Response>;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const abort = () => reject(new Error('MCP authorization was cancelled'));
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (signal?.aborted) {
      cleanup();
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    promise.then(
      value => {
        cleanup();
        resolve(value);
      },
      error => {
        cleanup();
        reject(error);
      },
    );
  });
}

interface OAuthSession {
  clientInformation?: OAuthClientInformationMixed;
  clientRedirectUri?: string;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

class StoredOAuthProvider implements OAuthClientProvider {
  private readonly key: string;
  private readonly redirectUri: string;
  private session: OAuthSession;

  constructor(private readonly store: SqliteStore, serverId: string, redirectUri: string) {
    this.key = `${MCP_OAUTH_STORE_PREFIX}${serverId}`;
    this.redirectUri = redirectUri;
    const storedSession = store.get<OAuthSession>(this.key) || {};
    // Dynamic OAuth registrations are bound to the callback URL. Older app
    // versions used a random port for every attempt, so their client records
    // cannot safely be reused with the stable callback URL below.
    const hasStaleInteractiveRegistration =
      !storedSession.tokens && Boolean(storedSession.clientInformation);
    if (storedSession.clientRedirectUri !== redirectUri || hasStaleInteractiveRegistration) {
      this.session = {};
      this.persist();
    } else {
      this.session = storedSession;
    }
  }

  get redirectUrl(): string {
    return this.redirectUri;
  }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'ZhiYuan Agent', redirect_uris: [this.redirectUri] };
  }
  clientInformation() { return this.session.clientInformation; }
  saveClientInformation(value: OAuthClientInformationMixed) {
    this.session.clientInformation = value;
    this.session.clientRedirectUri = this.redirectUri;
    this.persist();
  }
  tokens() { return this.session.tokens; }
  saveTokens(value: OAuthTokens) { this.session.tokens = value; this.persist(); }
  redirectToAuthorization(url: URL) { return shell.openExternal(url.toString()); }
  saveCodeVerifier(value: string) { this.session.codeVerifier = value; this.persist(); }
  codeVerifier() { if (!this.session.codeVerifier) throw new Error('OAuth code verifier is missing'); return this.session.codeVerifier; }
  private persist() { this.store.set(this.key, this.session); }
}

export class McpOAuthManager {
  constructor(private readonly store: SqliteStore) {}

  async authorize(serverId: string, serverUrl: string, signal?: AbortSignal): Promise<string> {
    const deadline = Date.now() + MCP_OAUTH_TOTAL_TIMEOUT_MS;
    const remainingTimeout = () => Math.max(1, deadline - Date.now());
    const preferredCallbackPort = getStoredOAuthCallbackPort(this.store, serverId);
    const { callbackPort, callbackServer } = await createOAuthCallbackServer(
      serverId,
      preferredCallbackPort,
    );
    const redirectUri = `http://127.0.0.1:${callbackPort}${MCP_OAUTH_CALLBACK_PATH}`;
    const provider = new StoredOAuthProvider(this.store, serverId, redirectUri);

    try {
      const result = await withTimeout(
        auth(provider, { serverUrl, scope: undefined, fetchFn: electronFetch }),
        Math.min(MCP_OAUTH_REQUEST_TIMEOUT_MS, remainingTimeout()),
        'MCP OAuth discovery',
        signal,
      );
      if (result === 'AUTHORIZED') return provider.tokens()?.access_token || '';
      const code = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
        };
        const finish = (error?: Error, value?: string) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(error);
          else resolve(value || '');
        };
        const abort = () => finish(new Error('MCP authorization was cancelled'));
        const timeout = setTimeout(
          () => finish(new Error('MCP OAuth authorization timed out. Complete browser authorization and try again.')),
          remainingTimeout(),
        );
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener('abort', abort, { once: true });
        callbackServer.once('request', (request, response) => {
          const url = new URL(request.url || '/', redirectUri);
          const authorizationCode = url.searchParams.get('code');
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<html><body><p>You can return to ZhiYuan Agent.</p></body></html>');
          if (!authorizationCode) finish(new Error('OAuth authorization code is missing'));
          else finish(undefined, authorizationCode);
        });
      });
      await withTimeout(
        auth(provider, { serverUrl, authorizationCode: code, fetchFn: electronFetch }),
        Math.min(MCP_OAUTH_REQUEST_TIMEOUT_MS, remainingTimeout()),
        'MCP OAuth token exchange',
        signal,
      );
      return provider.tokens()?.access_token || '';
    } finally {
      callbackServer.close();
    }
  }

  /**
   * Refresh an existing OAuth session without opening a browser. Returns null
   * when the session has no refresh token and therefore needs interactive auth.
   */
  async refreshAccessToken(serverId: string, serverUrl: string): Promise<string | null> {
    const callbackPort = getStoredOAuthCallbackPort(this.store, serverId) ?? getMcpOAuthCallbackPort(serverId);
    const provider = new StoredOAuthProvider(
      this.store,
      serverId,
      `http://127.0.0.1:${callbackPort}${MCP_OAUTH_CALLBACK_PATH}`,
    );
    if (!provider.tokens()?.refresh_token) return null;
    const result = await auth(provider, { serverUrl, scope: undefined, fetchFn: electronFetch });
    if (result !== 'AUTHORIZED') {
      throw new Error('OAuth token refresh requires interactive authorization');
    }
    return provider.tokens()?.access_token || null;
  }
}
