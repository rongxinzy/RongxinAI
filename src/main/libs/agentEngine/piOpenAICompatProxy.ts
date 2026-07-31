import http, { type IncomingMessage, type ServerResponse } from 'http';

import { buildOpenAIChatCompletionsURL } from '../coworkFormatTransform';

interface PiOpenAICompatUpstream {
  baseURL: string;
  apiKey?: string;
}

interface OpenAIStreamNormalizeState {
  hasFinishReason: boolean;
  sentDone: boolean;
}

const PI_OPENAI_COMPAT_PROXY_PREFIX = '/__pi_openai_compat';
const OPENAI_STREAM_DONE_MARKER = '[DONE]';
const FALLBACK_FINISH_REASON = 'stop';

const upstreams = new Map<string, PiOpenAICompatUpstream>();
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

  const proxiedPath = `/${pathSegments.slice(2).join('/')}`;
  if (!isOpenAIChatCompletionsPath(proxiedPath)) {
    writeJson(response, 404, { error: 'Only OpenAI chat completions are supported.' });
    return;
  }

  const body = await readRequestBody(request);
  const model = extractRequestModel(body);
  const upstreamURL = buildOpenAIChatCompletionsURL(upstream.baseURL);
  const upstreamResponse = await fetch(upstreamURL, {
    method: 'POST',
    headers: createFetchHeaders(request, upstream),
    body: body.toString('utf8'),
  });

  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  const shouldNormalizeStream =
    contentType.includes('text/event-stream') || requestWantsStream(body);

  if (shouldNormalizeStream && upstreamResponse.body) {
    response.writeHead(upstreamResponse.status, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    await pipeNormalizedOpenAIStream(upstreamResponse.body, response, model);
    return;
  }

  copyResponseHeaders(upstreamResponse, response);
  const text = await upstreamResponse.text();
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
  });
  return `http://127.0.0.1:${port}${PI_OPENAI_COMPAT_PROXY_PREFIX}/${encodeURIComponent(
    providerId,
  )}/v1`;
}

export async function stopPiOpenAICompatProxyForTests(): Promise<void> {
  upstreams.clear();
  proxyPort = null;
  proxyStartPromise = null;
  const server = proxyServer;
  proxyServer = null;
  if (!server) {
    return;
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
}
