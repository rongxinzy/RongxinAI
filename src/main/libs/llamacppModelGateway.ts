import { addAbortListener } from 'node:events';
import http from 'node:http';

const GATEWAY_HOST = '127.0.0.1';
const DEFAULT_GATEWAY_PORT = 8080;
const GATEWAY_PATH_PREFIX = '/v1/';
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
const LLAMA_CPP_EXCEEDED_PATTERN = /context size has been exceeded/i;
const PI_LLAMA_CPP_OVERFLOW_PATTERN = /exceeds the available context size/i;
const PI_LLAMA_CPP_OVERFLOW_HINT = 'exceeds the available context size';

export type LlamaCppGatewayModelLease = {
  baseUrl: string;
  release: () => void;
};

export type LlamaCppModelGatewayOptions = {
  acquireModel: (modelName: string) => Promise<LlamaCppGatewayModelLease>;
  listModels: () => Array<{ id: string; owned_by?: string }>;
  shutdownSignal: AbortSignal;
};

export type LlamaCppModelGateway = {
  baseUrl: () => string | null;
  isChanging: () => boolean;
  start: (port: number) => Promise<void>;
  stop: () => Promise<void>;
};

export function resolveLlamaCppGatewayPort(port?: string): number {
  return Number.parseInt(port ?? '', 10) || DEFAULT_GATEWAY_PORT;
}

/**
 * Loopback-only model gateway in front of the llama-server router: on-demand
 * model loading, in-flight leases and the loaded-only /v1/models listing.
 * LAN access is served by the bundled model gateway instead; this listener
 * always binds 127.0.0.1 and never authenticates.
 */
export function createLlamaCppModelGateway(
  options: LlamaCppModelGatewayOptions,
): LlamaCppModelGateway {
  let server: http.Server | null = null;
  let boundPort: number | null = null;
  let configuredPort: number | null = null;
  let pending: Promise<void> | undefined;
  const { shutdownSignal } = options;

  const changeListener = (change: () => Promise<void>): Promise<void> => {
    const operation = Promise.resolve(pending)
      .catch(() => {})
      .then(change)
      .finally(() => {
        if (pending === operation) pending = undefined;
      });
    pending = operation;
    return operation;
  };

  const closeListener = async (): Promise<void> => {
    const current = server;
    if (!current) return;
    server = null;
    boundPort = null;
    configuredPort = null;
    const closed = new Promise<void>((resolve, reject) => {
      current.close(error => (error ? reject(error) : resolve()));
    });
    using _shutdown = addAbortListener(shutdownSignal, () => current.closeAllConnections());
    await closed;
  };

  return {
    baseUrl: () => (boundPort ? `http://${GATEWAY_HOST}:${boundPort}/v1` : null),
    isChanging: () => pending !== undefined,
    start: port =>
      changeListener(async () => {
        shutdownSignal.throwIfAborted();
        if (configuredPort === port) return;
        await closeListener();
        shutdownSignal.throwIfAborted();
        await new Promise<void>((resolve, reject) => {
          const nextServer = http.createServer((request, response) => {
            void handleGatewayRequest(request, response, options).catch(error => {
              if (response.destroyed || response.writableEnded) return;
              if (response.headersSent) {
                // A truncated stream must fail at the client so it can detect the missing output.
                response.destroy();
                return;
              }
              const message =
                error instanceof Error ? error.message : 'Local model gateway failed.';
              writeJsonError(response, 502, message);
            });
          });
          nextServer.once('error', reject);
          nextServer.listen(port, GATEWAY_HOST, () => {
            const address = nextServer.address();
            if (!address || typeof address === 'string') {
              nextServer.close();
              reject(new Error('Local model gateway did not expose a TCP port.'));
              return;
            }
            server = nextServer;
            boundPort = address.port;
            configuredPort = port;
            console.log(
              `[LlamaCppGateway] local model gateway started on ${GATEWAY_HOST}:${boundPort}`,
            );
            resolve();
          });
        });
        if (shutdownSignal.aborted) {
          await closeListener();
          shutdownSignal.throwIfAborted();
        }
      }),
    stop: () => changeListener(closeListener),
  };
}

async function handleGatewayRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  options: LlamaCppModelGatewayOptions,
): Promise<void> {
  if (!request.url?.startsWith(GATEWAY_PATH_PREFIX)) {
    writeJsonError(response, 404, 'Route not found.');
    return;
  }
  if (request.method === 'GET' && request.url === '/v1/models') {
    writeJson(response, 200, { object: 'list', data: options.listModels().map(toOpenAiModel) });
    return;
  }
  if (request.method !== 'POST' || !request.url.startsWith('/v1/chat/completions')) {
    writeJsonError(response, 404, 'Only model-aware OpenAI chat completion routes are available.');
    return;
  }

  const body = await readRequestBody(request);
  const modelName = getModelName(body);
  if (!modelName) {
    writeJsonError(response, 400, 'A local model name is required.');
    return;
  }

  const lease = await options.acquireModel(modelName);
  try {
    await forwardRequest(request, response, lease.baseUrl, body);
  } finally {
    lease.release();
  }
}

function toOpenAiModel(model: { id: string; owned_by?: string }): Record<string, string> {
  return { id: model.id, object: 'model', owned_by: model.owned_by ?? 'zhiyuan-agent' };
}

async function forwardRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  upstreamBaseUrl: string,
  body: Buffer,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once('aborted', abort);
  response.once('close', abort);
  try {
    const upstreamResponse = await fetch(`${upstreamBaseUrl}${request.url ?? ''}`, {
      method: request.method,
      headers: copyRequestHeaders(request.headers),
      body: body.length > 0 ? new Uint8Array(body) : undefined,
      signal: controller.signal,
    });
    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      const normalized = normalizeLlamaCppOverflowBody(errorText);
      const isLlamaOverflow = normalized !== errorText;
      response.statusCode =
        isLlamaOverflow && upstreamResponse.status >= 500 ? 400 : upstreamResponse.status;
      upstreamResponse.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (
          lower === 'transfer-encoding' ||
          (isLlamaOverflow && (lower === 'content-length' || lower === 'content-encoding'))
        ) {
          return;
        }
        response.setHeader(key, value);
      });
      response.end(normalized);
      return;
    }
    response.statusCode = upstreamResponse.status;
    const isSse =
      upstreamResponse.headers.get('content-type')?.includes('text/event-stream') ?? false;
    upstreamResponse.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === 'transfer-encoding' || (isSse && lower === 'content-length')) return;
      response.setHeader(key, value);
    });
    if (!upstreamResponse.body) {
      response.end();
      return;
    }
    const reader = upstreamResponse.body.getReader();
    const decoder = isSse ? new TextDecoder() : null;
    while (!response.writableEnded) {
      const { done, value } = await reader.read();
      if (done) break;
      if (decoder) {
        const text = decoder.decode(value, { stream: true });
        if (text) {
          response.write(normalizeLlamaCppSseChunk(text));
        }
      } else {
        response.write(Buffer.from(value));
      }
    }
    if (decoder) {
      const trailing = decoder.decode();
      if (trailing && !response.writableEnded) {
        response.write(normalizeLlamaCppSseChunk(trailing));
      }
    }
    response.end();
  } finally {
    request.removeListener('aborted', abort);
    response.removeListener('close', abort);
  }
}

export function normalizeLlamaCppOverflowMessage(message: string): string {
  if (!LLAMA_CPP_EXCEEDED_PATTERN.test(message) || PI_LLAMA_CPP_OVERFLOW_PATTERN.test(message)) {
    return message;
  }
  return `${message} (${PI_LLAMA_CPP_OVERFLOW_HINT})`;
}

export function normalizeLlamaCppOverflowBody(bodyText: string): string {
  if (!LLAMA_CPP_EXCEEDED_PATTERN.test(bodyText) || PI_LLAMA_CPP_OVERFLOW_PATTERN.test(bodyText)) {
    return bodyText;
  }
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: unknown }; message?: unknown };
    if (parsed && typeof parsed === 'object') {
      if (
        parsed.error &&
        typeof parsed.error === 'object' &&
        typeof parsed.error.message === 'string'
      ) {
        parsed.error.message = normalizeLlamaCppOverflowMessage(parsed.error.message);
        return JSON.stringify(parsed);
      }
      if (typeof parsed.message === 'string') {
        parsed.message = normalizeLlamaCppOverflowMessage(parsed.message);
        return JSON.stringify(parsed);
      }
    }
  } catch {
    // Plain-text error bodies fall through to direct normalization below.
  }
  return normalizeLlamaCppOverflowMessage(bodyText);
}

function normalizeLlamaCppSseChunk(chunk: string): string {
  if (!LLAMA_CPP_EXCEEDED_PATTERN.test(chunk) || PI_LLAMA_CPP_OVERFLOW_PATTERN.test(chunk)) {
    return chunk;
  }
  return chunk
    .split('\n')
    .map(line =>
      line.startsWith('data:') && LLAMA_CPP_EXCEEDED_PATTERN.test(line)
        ? `data: ${normalizeLlamaCppOverflowBody(line.slice(5).trimStart())}`
        : normalizeLlamaCppOverflowBody(line),
    )
    .join('\n');
}

function copyRequestHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) => {
      if (key === 'host' || key === 'content-length' || value === undefined) return [];
      return [[key, Array.isArray(value) ? value.join(', ') : value]];
    }),
  );
}

async function readRequestBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BODY_BYTES) {
      throw new Error('Local model request body exceeds the allowed size.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function getModelName(body: Buffer): string {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { model?: unknown };
    return typeof parsed.model === 'string' ? parsed.model.trim() : '';
  } catch {
    return '';
  }
}

function writeJson(response: http.ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function writeJsonError(response: http.ServerResponse, status: number, message: string): void {
  writeJson(response, status, { error: { message } });
}
