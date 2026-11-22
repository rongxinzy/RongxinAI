import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { session, shell } from 'electron';
import http from 'http';

import type { SqliteStore } from '../sqliteStore';
import { McpCredentialVault } from './mcpCredentialVault';

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
  return MCP_OAUTH_CALLBACK_PORT_BASE + (((hash >>> 0) + offset) % MCP_OAUTH_CALLBACK_PORT_RANGE);
}

function getStoredOAuthCallbackPort(
  credentialVault: McpCredentialVault,
  serverId: string,
): number | undefined {
  const key = `${MCP_OAUTH_STORE_PREFIX}${serverId}`;
  const storedRedirectUri = credentialVault.getValue<OAuthSession>(key)?.clientRedirectUri;
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
  signal?: AbortSignal,
): Promise<{
  callbackPort: number;
  callbackServer: http.Server;
}> {
  const attemptedPorts = new Set<number>();
  for (let attempt = 0; attempt < MCP_OAUTH_CALLBACK_PORT_ATTEMPTS; attempt += 1) {
    signal?.throwIfAborted();
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
  session.defaultSession.fetch(
    typeof input === 'string' ? input : input.toString(),
    init,
  ) as unknown as Promise<Response>;

function oauthFetchWithSignal(signal: AbortSignal): typeof electronFetch {
  return (input, init) => {
    signal.throwIfAborted();
    return electronFetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
    });
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error('MCP authorization was cancelled'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
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

class SilentRefreshStopped extends Error {}

class StoredOAuthProvider implements OAuthClientProvider {
  private readonly key: string;
  private readonly redirectUri: string;
  private readonly refreshRevision: string | undefined;
  private session: OAuthSession;
  readonly saveClientInformation?: (value: OAuthClientInformationMixed) => void;

  constructor(
    private readonly store: SqliteStore,
    private readonly credentialVault: McpCredentialVault,
    serverId: string,
    redirectUri: string,
    private readonly openAuthorizationUrl?: (url: URL) => Promise<void>,
    private readonly authorizationSignal?: AbortSignal,
  ) {
    this.key = `${MCP_OAUTH_STORE_PREFIX}${serverId}`;
    this.redirectUri = redirectUri;
    const storedSession = credentialVault.getValue<OAuthSession>(this.key) ?? {};
    this.refreshRevision = openAuthorizationUrl ? undefined : JSON.stringify(store.get(this.key));
    // Dynamic OAuth registrations are bound to the callback URL. Older app
    // versions used a random port for every attempt, so their client records
    // cannot safely be reused with the stable callback URL below.
    const hasStaleInteractiveRegistration =
      !storedSession.tokens && Boolean(storedSession.clientInformation);
    if (storedSession.clientRedirectUri !== redirectUri || hasStaleInteractiveRegistration) {
      this.session = {};
      if (openAuthorizationUrl) this.persist();
    } else {
      this.session = storedSession;
    }
    // The SDK treats an absent save callback as a pre-registered client.
    if (openAuthorizationUrl) {
      this.saveClientInformation = value => {
        this.session.clientInformation = value;
        this.session.clientRedirectUri = this.redirectUri;
        this.persist();
      };
    }
  }

  get redirectUrl(): string {
    return this.redirectUri;
  }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'ZhiYuan Agent', redirect_uris: [this.redirectUri] };
  }
  clientInformation() {
    return this.session.clientInformation;
  }
  tokens() {
    return this.session.tokens;
  }
  saveTokens(value: OAuthTokens) {
    this.authorizationSignal?.throwIfAborted();
    // Explicit authorization or unlink can change the stored session while a refresh is pending.
    if (
      !this.openAuthorizationUrl &&
      JSON.stringify(this.store.get(this.key)) !== this.refreshRevision
    ) {
      throw new SilentRefreshStopped();
    }
    const client = this.session.clientInformation;
    if (!this.openAuthorizationUrl && client && !client.issuer && value.issuer) {
      this.session.clientInformation = { ...client, issuer: value.issuer };
    }
    this.session.tokens = value;
    this.persist();
  }
  redirectToAuthorization(url: URL) {
    if (!this.openAuthorizationUrl) throw new SilentRefreshStopped();
    this.authorizationSignal?.throwIfAborted();
    return this.openAuthorizationUrl(url);
  }
  saveCodeVerifier(value: string) {
    if (!this.openAuthorizationUrl) throw new SilentRefreshStopped();
    this.session.codeVerifier = value;
    this.persist();
  }
  codeVerifier() {
    if (!this.session.codeVerifier) throw new Error('OAuth code verifier is missing');
    return this.session.codeVerifier;
  }
  private persist() {
    this.authorizationSignal?.throwIfAborted();
    this.credentialVault.setValue(this.key, this.session);
  }
}

export class McpOAuthManager {
  private readonly credentialVault: McpCredentialVault;

  constructor(private readonly store: SqliteStore) {
    this.credentialVault = new McpCredentialVault(store);
  }

  async authorize(
    serverId: string,
    serverUrl: string,
    requestSignal?: AbortSignal,
  ): Promise<string> {
    const authorization = new AbortController();
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, authorization.signal])
      : authorization.signal;
    signal.throwIfAborted();
    const deadline = Date.now() + MCP_OAUTH_TOTAL_TIMEOUT_MS;
    const remainingTimeout = () => Math.max(1, deadline - Date.now());
    const preferredCallbackPort = getStoredOAuthCallbackPort(this.credentialVault, serverId);
    const { callbackPort, callbackServer } = await createOAuthCallbackServer(
      serverId,
      preferredCallbackPort,
      signal,
    );
    const redirectUri = `http://127.0.0.1:${callbackPort}${MCP_OAUTH_CALLBACK_PATH}`;
    try {
      signal.throwIfAborted();
      const provider = new StoredOAuthProvider(
        this.store,
        this.credentialVault,
        serverId,
        redirectUri,
        url => shell.openExternal(url.toString()),
        signal,
      );
      const fetchFn = oauthFetchWithSignal(signal);
      const result = await withTimeout(
        auth(provider, { serverUrl, scope: undefined, fetchFn }),
        Math.min(MCP_OAUTH_REQUEST_TIMEOUT_MS, remainingTimeout()),
        'MCP OAuth discovery',
        signal,
      );
      signal.throwIfAborted();
      if (result === 'AUTHORIZED') return provider.tokens()?.access_token || '';
      const code = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', abort);
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
          () =>
            finish(
              new Error(
                'MCP OAuth authorization timed out. Complete browser authorization and try again.',
              ),
            ),
          remainingTimeout(),
        );
        if (signal.aborted) {
          abort();
          return;
        }
        signal.addEventListener('abort', abort, { once: true });
        callbackServer.once('request', (request, response) => {
          const url = new URL(request.url || '/', redirectUri);
          const authorizationCode = url.searchParams.get('code');
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<html><body><p>You can return to ZhiYuan Agent.</p></body></html>');
          if (!authorizationCode) finish(new Error('OAuth authorization code is missing'));
          else finish(undefined, authorizationCode);
        });
      });
      signal.throwIfAborted();
      await withTimeout(
        auth(provider, { serverUrl, authorizationCode: code, fetchFn }),
        Math.min(MCP_OAUTH_REQUEST_TIMEOUT_MS, remainingTimeout()),
        'MCP OAuth token exchange',
        signal,
      );
      signal.throwIfAborted();
      return provider.tokens()?.access_token || '';
    } finally {
      // The SDK can still unwind after a timeout or cancellation.
      authorization.abort();
      await new Promise<void>((resolve, reject) => {
        callbackServer.close(error => (error ? reject(error) : resolve()));
        callbackServer.closeAllConnections();
      });
    }
  }

  /**
   * Refresh an existing OAuth session without starting interactive authorization.
   */
  async refreshAccessToken(
    serverId: string,
    serverUrl: string,
    requestSignal?: AbortSignal,
  ): Promise<string | null> {
    const refresh = new AbortController();
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, refresh.signal])
      : refresh.signal;
    signal.throwIfAborted();
    const callbackPort =
      getStoredOAuthCallbackPort(this.credentialVault, serverId) ??
      getMcpOAuthCallbackPort(serverId);
    const provider = new StoredOAuthProvider(
      this.store,
      this.credentialVault,
      serverId,
      `http://127.0.0.1:${callbackPort}${MCP_OAUTH_CALLBACK_PATH}`,
      undefined,
      signal,
    );
    if (!provider.tokens()?.refresh_token || !provider.clientInformation()) return null;
    try {
      const result = await withTimeout(
        auth(provider, { serverUrl, scope: undefined, fetchFn: oauthFetchWithSignal(signal) }),
        MCP_OAUTH_REQUEST_TIMEOUT_MS,
        'MCP OAuth refresh',
        signal,
      );
      signal.throwIfAborted();
      return result === 'AUTHORIZED' ? provider.tokens()?.access_token || null : null;
    } catch (error) {
      if (error instanceof SilentRefreshStopped) return null;
      throw error;
    } finally {
      refresh.abort();
    }
  }
}
