import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { shell } from 'electron';
import http from 'http';

import type { SqliteStore } from '../sqliteStore';

const OAUTH_STORE_PREFIX = 'mcp.oauth.';

interface OAuthSession {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

class StoredOAuthProvider implements OAuthClientProvider {
  private readonly key: string;
  private readonly redirectUri: string;
  private session: OAuthSession;

  constructor(private readonly store: SqliteStore, serverId: string, redirectUri: string) {
    this.key = `${OAUTH_STORE_PREFIX}${serverId}`;
    this.redirectUri = redirectUri;
    this.session = store.get<OAuthSession>(this.key) || {};
  }

  get redirectUrl(): string {
    return this.redirectUri;
  }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'ZhiYuan Agent', redirect_uris: [this.redirectUri] };
  }
  clientInformation() { return this.session.clientInformation; }
  saveClientInformation(value: OAuthClientInformationMixed) { this.session.clientInformation = value; this.persist(); }
  tokens() { return this.session.tokens; }
  saveTokens(value: OAuthTokens) { this.session.tokens = value; this.persist(); }
  redirectToAuthorization(url: URL) { return shell.openExternal(url.toString()); }
  saveCodeVerifier(value: string) { this.session.codeVerifier = value; this.persist(); }
  codeVerifier() { if (!this.session.codeVerifier) throw new Error('OAuth code verifier is missing'); return this.session.codeVerifier; }
  private persist() { this.store.set(this.key, this.session); }
}

export class McpOAuthManager {
  constructor(private readonly store: SqliteStore) {}

  async authorize(serverId: string, serverUrl: string): Promise<string> {
    const callbackServer = http.createServer();
    await new Promise<void>((resolve, reject) => {
      callbackServer.once('error', reject);
      callbackServer.listen(0, '127.0.0.1', () => resolve());
    });
    const address = callbackServer.address();
    if (!address || typeof address === 'string') throw new Error('OAuth callback server did not start');
    const redirectUri = `http://127.0.0.1:${address.port}/mcp-oauth/callback`;
    const provider = new StoredOAuthProvider(this.store, serverId, redirectUri);

    try {
      const result = await auth(provider, { serverUrl, scope: undefined });
      if (result === 'AUTHORIZED') return provider.tokens()?.access_token || '';
      const code = await new Promise<string>((resolve, reject) => {
        callbackServer.once('request', (request, response) => {
          const url = new URL(request.url || '/', redirectUri);
          const authorizationCode = url.searchParams.get('code');
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<html><body><p>You can return to ZhiYuan Agent.</p></body></html>');
          if (!authorizationCode) reject(new Error('OAuth authorization code is missing'));
          else resolve(authorizationCode);
        });
      });
      await auth(provider, { serverUrl, authorizationCode: code });
      return provider.tokens()?.access_token || '';
    } finally {
      callbackServer.close();
    }
  }
}
