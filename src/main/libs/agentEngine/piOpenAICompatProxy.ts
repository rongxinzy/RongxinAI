import http, { type IncomingMessage, type ServerResponse } from 'http';

import { timingSafeEqual } from 'crypto';

import { buildOpenAIChatCompletionsURL } from '../coworkFormatTransform';
interface PiOpenAICompatUpstream {
  baseURL: string;
  apiKey?: string;
  requiredIncomingApiKey?: string;
}

function incomingApiKeyMatches(request: IncomingMessage, expected: string): boolean {
  const authorization = request.headers.authorization;
  const actual = typeof authorization === 'string' ? authorization : '';
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

interface OpenAIStreamNormalizeState {
  hasFinishReason: boolean;
  sentDone: boolean;
}

const PI_OPENAI_COMPAT_PROXY_PREFIX = '/__pi_openai_compat';
const OPENAI_STREAM_DONE_MARKER = '[DONE]';
const FALLBACK_FINISH_REASON = 'stop';

const upstreams = new Map<string, PiOpenAICompatUpstream>();
const tokenRefreshers = new Map<string, PiOpenAICompatTokenRefreshRegistration>();
let proxyServer: http.Server | null = null;
let proxyPort: number | null = null;
let proxyStartPromise: Promise<number> | null = null;

function isOpenAIChatCompletionsPath(pathname: string): boolean {
  return pathname.endsWith('/chat/completions');
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

  const apiKey = upstream.apiKey?.trim();
  if (apiKey) {
    headers.set('authorization', `Bearer ${apiKey}`);
  } else {
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

  const registration = tokenRefreshers.get(providerId);
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
    if (tokenRefreshers.get(providerId) !== registration) return false;
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

function extractRequestModel(body: Buffer): string | undefined {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { model?: unknown };
    return typeof parsed.model === 'string' ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

/**
 * OpenAI's newer protocol uses the 'developer' role; most self-hosted
 * OpenAI-compatible gateways (new-api / one-api and similar) validate
 * roles against user/assistant/system/tool and reject it. The proxy
 * serves user-added providers exactly, so remap developer to system
 * before forwarding. Both roles are accepted by the models themselves;
 * system is the broadly supported spelling.
 */
export function remapDeveloperRolesForOpenAICompletions(body: Buffer): Buffer {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    let changed = false;
    for (const message of messages) {
      if (typeof message !== 'object' || message === null || Array.isArray(message)) {
        continue;
      }
      const record = message as Record<string, unknown>;
      if (record.role === 'developer') {
        record.role = 'system';
        changed = true;
      }
    }
    if (!changed) return body;
    return Buffer.from(JSON.stringify(parsed), 'utf8');
  } catch {
    // Non-JSON or an unexpected payload shape: pass through unchanged.
    return body;
  }
}

function requestWantsStream(body: Buffer): boolean {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { stream?: unknown };
    return parsed.stream === true;
  } catch {
    return false;
  }
}

function getSSEDataPayload(packet: string): string | null {
  const dataLines = packet
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join('\n') : null;
}

export function openAIStreamPayloadHasFinishReason(payload: string): boolean {
  if (!payload || payload === OPENAI_STREAM_DONE_MARKER) {
    return false;
  }

  try {
    const parsed = JSON.parse(payload) as { choices?: Array<{ finish_reason?: unknown }> };
    return Array.isArray(parsed.choices)
      ? parsed.choices.some(
          choice => typeof choice?.finish_reason === 'string' && choice.finish_reason,
        )
      : false;
  } catch {
    return false;
  }
}

export function createOpenAIMissingFinishReasonChunk(model?: string): Record<string, unknown> {
  return {
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    ...(model ? { model } : {}),
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: FALLBACK_FINISH_REASON,
      },
    ],
  };
}

function formatOpenAISSEData(data: unknown): string {
  return `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function convertOpenAIChatCompletionTextToSSEForPi(
  text: string,
  fallbackModel?: string,
): string | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = toRecord(JSON.parse(text));
  } catch {
    return null;
  }

  const choices = toArray(parsed.choices);
  if (choices.length === 0) {
    return `${formatOpenAISSEData(
      createOpenAIMissingFinishReasonChunk(toNonEmptyString(parsed.model) ?? fallbackModel),
    )}${formatOpenAISSEData(OPENAI_STREAM_DONE_MARKER)}`;
  }

  const id = toNonEmptyString(parsed.id) ?? `chatcmpl-${Date.now().toString(36)}`;
  const model = toNonEmptyString(parsed.model) ?? fallbackModel;
  const created =
    typeof parsed.created === 'number' ? parsed.created : Math.floor(Date.now() / 1000);
  let output = '';

  choices.forEach((choiceValue, fallbackIndex) => {
    const choice = toRecord(choiceValue);
    const message = toRecord(choice.message);
    const delta: Record<string, unknown> = {};
    const content = toNonEmptyString(message.content);
    const reasoning =
      toNonEmptyString(message.reasoning) ?? toNonEmptyString(message.reasoning_content);
    const toolCalls = toArray(message.tool_calls);

    if (content) {
      delta.content = content;
    }
    if (reasoning) {
      delta.reasoning_content = reasoning;
    }
    if (toolCalls.length > 0) {
      delta.tool_calls = toolCalls;
    }

    output += formatOpenAISSEData({
      id,
      object: 'chat.completion.chunk',
      created,
      ...(model ? { model } : {}),
      choices: [
        {
          index: typeof choice.index === 'number' ? choice.index : fallbackIndex,
          delta,
          finish_reason: toNonEmptyString(choice.finish_reason) ?? FALLBACK_FINISH_REASON,
        },
      ],
    });
  });

  output += formatOpenAISSEData(OPENAI_STREAM_DONE_MARKER);
  return output;
}

function normalizeOpenAISSEPacketForPi(
  packet: string,
  state: OpenAIStreamNormalizeState,
  model?: string,
): string {
  const payload = getSSEDataPayload(packet);
  if (payload === null) {
    return packet ? `${packet}\n\n` : '';
  }

  if (payload === OPENAI_STREAM_DONE_MARKER) {
    state.sentDone = true;
    return state.hasFinishReason
      ? formatOpenAISSEData(OPENAI_STREAM_DONE_MARKER)
      : `${formatOpenAISSEData(createOpenAIMissingFinishReasonChunk(model))}${formatOpenAISSEData(
          OPENAI_STREAM_DONE_MARKER,
        )}`;
  }

  if (openAIStreamPayloadHasFinishReason(payload)) {
    state.hasFinishReason = true;
  }
  return `${packet}\n\n`;
}

export function normalizeOpenAISSETextForPi(text: string, model?: string): string {
  const state: OpenAIStreamNormalizeState = { hasFinishReason: false, sentDone: false };
  const packets = text.split(/\r?\n\r?\n/).filter(packet => packet.trim().length > 0);
  let output = '';

  for (const packet of packets) {
    output += normalizeOpenAISSEPacketForPi(packet, state, model);
  }

  if (!state.sentDone) {
    if (!state.hasFinishReason) {
      output += formatOpenAISSEData(createOpenAIMissingFinishReasonChunk(model));
    }
    output += formatOpenAISSEData(OPENAI_STREAM_DONE_MARKER);
  }

  return output;
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

function normalizeNonStreamOpenAIResponse(text: string): string {
  try {
    const parsed = JSON.parse(text) as { choices?: Array<{ finish_reason?: unknown }> };
    if (Array.isArray(parsed.choices)) {
      for (const choice of parsed.choices) {
        if (!choice.finish_reason) {
          choice.finish_reason = FALLBACK_FINISH_REASON;
        }
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

async function pipeNormalizedOpenAIStream(
  body: ReadableStream<Uint8Array>,
  response: ServerResponse,
  model?: string,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const state: OpenAIStreamNormalizeState = { hasFinishReason: false, sentDone: false };
  let buffer = '';

  const flushPackets = (): void => {
    const packets = buffer.split(/\r?\n\r?\n/);
    buffer = packets.pop() ?? '';
    for (const packet of packets) {
      if (packet.trim().length === 0) {
        continue;
      }
      response.write(normalizeOpenAISSEPacketForPi(packet, state, model));
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      flushPackets();
    }

    const remaining = buffer.trim();
    if (remaining) {
      response.write(normalizeOpenAISSEPacketForPi(remaining, state, model));
    }

    if (!state.sentDone) {
      if (!state.hasFinishReason) {
        response.write(formatOpenAISSEData(createOpenAIMissingFinishReasonChunk(model)));
      }
      response.write(formatOpenAISSEData(OPENAI_STREAM_DONE_MARKER));
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
  if (!isOpenAIChatCompletionsPath(proxiedPath)) {
    writeJson(response, 404, { error: 'Only OpenAI chat completions are supported.' });
    return;
  }

  const body = remapDeveloperRolesForOpenAICompletions(await readRequestBody(request));
  const model = extractRequestModel(body);
  const upstreamURL = buildOpenAIChatCompletionsURL(upstream.baseURL);
  const rejectedApiKey = upstream.apiKey;
  const fetchUpstream = (): Promise<Response> =>
    fetch(upstreamURL, {
      method: 'POST',
      headers: createFetchHeaders(request, upstream),
      body: body.toString('utf8'),
    });
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
    await pipeNormalizedOpenAIStream(upstreamResponse.body, response, model);
    return;
  }

  const text = await upstreamResponse.text();
  if (requestWantsStream(body)) {
    const converted = convertOpenAIChatCompletionTextToSSEForPi(text, model);
    if (converted) {
      response.writeHead(upstreamResponse.status, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.end(converted);
      return;
    }
  }

  copyResponseHeaders(upstreamResponse, response);
  response.end(normalizeNonStreamOpenAIResponse(text));
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
): Promise<string> {
  const port = await ensurePiOpenAICompatProxyServer();
  upstreams.set(providerId, {
    baseURL: upstream.baseURL,
    apiKey: upstream.apiKey,
    requiredIncomingApiKey: upstream.requiredIncomingApiKey,
  });
  return `http://127.0.0.1:${port}${PI_OPENAI_COMPAT_PROXY_PREFIX}/${encodeURIComponent(
    providerId,
  )}/v1`;
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
