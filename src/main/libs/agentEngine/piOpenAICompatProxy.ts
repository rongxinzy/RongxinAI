/**
 * Loopback credential bridge for enterprise host providers.
 *
 * The unified gateway accepts only a loopback base URL and a local capability
 * key. This process holds the upstream token, injects it on the way out, and
 * refreshes it after a 401 or 403. OpenAI chat completions rewrite a developer
 * role to system on the way out; Kimi rejects that role. Other bytes pass through.
 */
import http, { type IncomingMessage, type ServerResponse } from 'http';

import { timingSafeEqual } from 'crypto';

import { ZhiyuanModelPoolHeader } from '../../../shared/modelPool/constants';
import { buildAnthropicMessagesUrl } from '../../../shared/providers';

/** Join an OpenAI-compatible base URL with the chat completions path. */
function buildOpenAIChatCompletionsURL(baseURL: string): string {
  const normalized = baseURL.trim().replace(/\/+$/, '');
  if (!normalized) return '/v1/chat/completions';
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.includes('generativelanguage.googleapis.com')) {
    if (normalized.endsWith('/v1beta/openai') || normalized.endsWith('/v1/openai')) {
      return `${normalized}/chat/completions`;
    }
    if (normalized.endsWith('/v1beta') || normalized.endsWith('/v1')) {
      const betaBase = normalized.endsWith('/v1') ? `${normalized.slice(0, -3)}v1beta` : normalized;
      return `${betaBase}/openai/chat/completions`;
    }
    return `${normalized}/v1beta/openai/chat/completions`;
  }
  if (normalized.includes('githubcopilot.com')) return `${normalized}/chat/completions`;
  if (/\/v\d+$/.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

interface PiOpenAICompatUpstream {
  baseURL: string;
  apiKey?: string;
  requiredIncomingApiKey?: string;
  forwardIncomingAuthorization?: boolean;
}

interface PiOpenAICompatUpstreamRegistrationOptions {
  /** Return the loopback base URL without the `/v1` suffix (Anthropic SDK appends `/v1/messages`). */
  bareBaseUrl?: boolean;
}

function incomingApiKeyMatches(request: IncomingMessage, expected: string): boolean {
  const authorization = request.headers.authorization;
  const apiKey = request.headers['x-api-key'];
  const actual =
    typeof authorization === 'string'
      ? authorization
      : typeof apiKey === 'string'
        ? `Bearer ${apiKey}`
        : '';
  const expectedAuthorization = `Bearer ${expected}`;
  const actualBytes = Buffer.from(actual, 'utf8');
  const expectedBytes = Buffer.from(expectedAuthorization, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export type PiOpenAICompatTokenRefresher = () => Promise<string>;

interface PiOpenAICompatTokenRefreshRegistration {
  readonly refresher: PiOpenAICompatTokenRefresher;
  refreshPromise: Promise<string> | null;
}

const PI_OPENAI_COMPAT_PROXY_PREFIX = '/__pi_openai_compat';

const upstreams = new Map<string, PiOpenAICompatUpstream>();
const tokenRefreshers = new Map<string, PiOpenAICompatTokenRefreshRegistration>();
let proxyServer: http.Server | null = null;
let proxyPort: number | null = null;
let proxyStartPromise: Promise<number> | null = null;

function isOpenAIChatCompletionsPath(pathname: string): boolean {
  return pathname.endsWith('/chat/completions');
}

function isAnthropicMessagesPath(pathname: string): boolean {
  return pathname.endsWith('/v1/messages');
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function createFetchHeaders(request: IncomingMessage, upstream: PiOpenAICompatUpstream): Headers {
  const headers = new Headers();
  const contentType = request.headers['content-type'];
  if (typeof contentType === 'string') {
    headers.set('content-type', contentType);
  } else {
    headers.set('content-type', 'application/json');
  }

  const accept = request.headers.accept;
  if (typeof accept === 'string') {
    headers.set('accept', accept);
  }

  for (const name of ['anthropic-version', 'anthropic-beta']) {
    const value = request.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }

  for (const name of Object.values(ZhiyuanModelPoolHeader)) {
    const value = request.headers[name];
    if (typeof value === 'string') headers.set(name, value);
  }

  const apiKey = upstream.apiKey?.trim();
  if (apiKey) {
    headers.set('authorization', `Bearer ${apiKey}`);
    if (typeof request.headers['x-api-key'] === 'string') headers.set('x-api-key', apiKey);
  } else if (upstream.forwardIncomingAuthorization !== false) {
    const authorization = request.headers.authorization;
    if (typeof authorization === 'string') {
      headers.set('authorization', authorization);
    }
  }

  return headers;
}

async function refreshPiOpenAICompatToken(
  providerId: string,
  rejectedApiKey: string | undefined,
): Promise<boolean> {
  const upstream = upstreams.get(providerId);
  if (!upstream) return false;
  if (upstream.apiKey !== rejectedApiKey) return true;

  // Per-model upstreams (`<providerKey>#<modelId>`) share the refresher
  // registered under the bare provider key.
  const registrationKey = tokenRefreshers.has(providerId)
    ? providerId
    : providerId.includes('#')
      ? providerId.slice(0, providerId.indexOf('#'))
      : providerId;
  const registration = tokenRefreshers.get(registrationKey);
  if (!registration) return false;
  if (!registration.refreshPromise) {
    registration.refreshPromise = registration
      .refresher()
      .then(apiKey => {
        const normalized = apiKey.trim();
        if (!normalized)
          throw new Error('Pi OpenAI compatibility token refresh returned no token.');
        return normalized;
      })
      .finally(() => {
        registration.refreshPromise = null;
      });
  }

  try {
    const apiKey = await registration.refreshPromise;
    if (tokenRefreshers.get(registrationKey) !== registration) return false;
    const currentUpstream = upstreams.get(providerId);
    if (!currentUpstream) return false;
    currentUpstream.apiKey = apiKey;
    return true;
  } catch (error) {
    console.warn(
      `[PiOpenAICompatProxy] failed to refresh credentials for provider ${providerId}:`,
      error,
    );
    return false;
  }
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Kimi rejects OpenAI's developer role. system is the spelling both Kimi and
 * the gateway accept.
 */
export function remapDeveloperRolesForOpenAICompletions(body: Buffer): Buffer {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    let changed = false;
    for (const message of messages) {
      if (typeof message !== 'object' || message === null || Array.isArray(message)) continue;
      const record = message as Record<string, unknown>;
      if (record.role === 'developer') {
        record.role = 'system';
        changed = true;
      }
    }
    if (!changed) return body;
    return Buffer.from(JSON.stringify(parsed), 'utf8');
  } catch {
    return body;
  }
}

function copyResponseHeaders(response: Response, serverResponse: ServerResponse): void {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'content-length' || lowerKey === 'content-encoding') {
      return;
    }
    headers[key] = value;
  });
  serverResponse.writeHead(response.status, headers);
}

async function pipeRawStream(
  body: ReadableStream<Uint8Array>,
  response: ServerResponse,
): Promise<void> {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) response.write(Buffer.from(value));
    }
  } finally {
    response.end();
  }
}

async function handleProxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== 'POST') {
    writeJson(response, 405, { error: 'Only POST requests are supported.' });
    return;
  }

  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const pathSegments = url.pathname.split('/').filter(Boolean);
  if (pathSegments[0] !== PI_OPENAI_COMPAT_PROXY_PREFIX.slice(1) || pathSegments.length < 3) {
    writeJson(response, 404, { error: 'Unknown Pi OpenAI compatibility proxy route.' });
    return;
  }

  const providerId = decodeURIComponent(pathSegments[1]);
  const upstream = upstreams.get(providerId);
  if (!upstream) {
    writeJson(response, 404, { error: 'Pi OpenAI compatibility upstream is not registered.' });
    return;
  }
  if (
    upstream.requiredIncomingApiKey &&
    !incomingApiKeyMatches(request, upstream.requiredIncomingApiKey)
  ) {
    writeJson(response, 401, { error: 'Pi OpenAI compatibility proxy authentication failed.' });
    return;
  }

  const proxiedPath = `/${pathSegments.slice(2).join('/')}`;
  const openAICompletions = isOpenAIChatCompletionsPath(proxiedPath);
  const anthropicMessages = !openAICompletions && isAnthropicMessagesPath(proxiedPath);
  if (!openAICompletions && !anthropicMessages) {
    writeJson(response, 404, {
      error: 'Only OpenAI chat completions or Anthropic messages are supported.',
    });
    return;
  }

  const rawBody = await readRequestBody(request);
  const body = openAICompletions ? remapDeveloperRolesForOpenAICompletions(rawBody) : rawBody;
  const upstreamURL = openAICompletions
    ? buildOpenAIChatCompletionsURL(upstream.baseURL)
    : buildAnthropicMessagesUrl(upstream.baseURL);
  const rejectedApiKey = upstream.apiKey;
  const fetchUpstream = (): Promise<Response> => {
    const active = upstreams.get(providerId);
    if (!active) return Promise.reject(new Error('Managed provider authorization was revoked.'));
    return fetch(upstreamURL, {
      method: 'POST',
      headers: createFetchHeaders(request, active),
      body: body.toString('utf8'),
    });
  };
  let upstreamResponse = await fetchUpstream();

  if (
    (upstreamResponse.status === 401 || upstreamResponse.status === 403) &&
    (await refreshPiOpenAICompatToken(providerId, rejectedApiKey))
  ) {
    await upstreamResponse.body?.cancel();
    upstreamResponse = await fetchUpstream();
  }

  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  const upstreamTextShouldPassThrough = !upstreamResponse.ok;

  if (upstreamTextShouldPassThrough) {
    copyResponseHeaders(upstreamResponse, response);
    response.end(await upstreamResponse.text());
    return;
  }

  if (contentType.includes('text/event-stream') && upstreamResponse.body) {
    response.writeHead(upstreamResponse.status, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    await pipeRawStream(upstreamResponse.body, response);
    return;
  }

  const text = await upstreamResponse.text();
  copyResponseHeaders(upstreamResponse, response);
  response.end(text);
}

async function ensurePiOpenAICompatProxyServer(): Promise<number> {
  if (proxyPort !== null) {
    return proxyPort;
  }
  if (proxyStartPromise) {
    return proxyStartPromise;
  }

  proxyStartPromise = new Promise<number>((resolve, reject) => {
    const server = http.createServer((request, response) => {
      handleProxyRequest(request, response).catch(error => {
        console.error('[PiOpenAICompatProxy] request failed:', error);
        if (!response.headersSent) {
          writeJson(response, 502, { error: 'Pi OpenAI compatibility proxy request failed.' });
          return;
        }
        response.end();
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Pi OpenAI compatibility proxy did not receive a TCP port.'));
        return;
      }
      proxyServer = server;
      proxyPort = address.port;
      resolve(address.port);
    });
  });

  return proxyStartPromise;
}

export async function registerPiOpenAICompatUpstream(
  providerId: string,
  upstream: PiOpenAICompatUpstream,
  options?: PiOpenAICompatUpstreamRegistrationOptions,
): Promise<string> {
  const port = await ensurePiOpenAICompatProxyServer();
  upstreams.set(providerId, {
    baseURL: upstream.baseURL,
    apiKey: upstream.apiKey,
    requiredIncomingApiKey: upstream.requiredIncomingApiKey,
    forwardIncomingAuthorization: upstream.forwardIncomingAuthorization,
  });
  const loopbackBaseUrl = `http://127.0.0.1:${port}${PI_OPENAI_COMPAT_PROXY_PREFIX}/${encodeURIComponent(
    providerId,
  )}`;
  return options?.bareBaseUrl ? loopbackBaseUrl : `${loopbackBaseUrl}/v1`;
}

export function unregisterPiOpenAICompatUpstream(providerId: string): void {
  upstreams.delete(providerId);
}

export function registerPiOpenAICompatTokenRefresher(
  providerId: string,
  refresher: PiOpenAICompatTokenRefresher,
): () => void {
  const registration: PiOpenAICompatTokenRefreshRegistration = {
    refresher,
    refreshPromise: null,
  };
  tokenRefreshers.set(providerId, registration);
  return () => {
    if (tokenRefreshers.get(providerId) === registration) {
      tokenRefreshers.delete(providerId);
    }
  };
}

export async function stopPiOpenAICompatProxyForTests(): Promise<void> {
  upstreams.clear();
  tokenRefreshers.clear();
  proxyPort = null;
  proxyStartPromise = null;
  const server = proxyServer;
  proxyServer = null;
  if (!server) {
    return;
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
}
