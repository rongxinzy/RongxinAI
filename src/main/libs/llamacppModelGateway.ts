import http from 'node:http';

import {
  LlamaCppGatewayAccessMode,
  type LlamaCppGatewayAccessMode as LlamaCppGatewayAccessModeType,
} from '../../shared/llamacpp';

const LOCAL_GATEWAY_HOST = '127.0.0.1';
const LAN_GATEWAY_HOST = '0.0.0.0';
const GATEWAY_PATH_PREFIX = '/v1/';
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

export type LlamaCppGatewayModelLease = {
  baseUrl: string;
  release: () => void;
};

export type LlamaCppModelGatewayOptions = {
  acquireModel: (modelName: string) => Promise<LlamaCppGatewayModelLease>;
  listModels: () => Array<{ id: string; owned_by?: string }>;
  getConfig: () => {
    port: number;
    accessMode: LlamaCppGatewayAccessModeType;
    lanToken?: string;
  };
};

export type LlamaCppModelGateway = {
  baseUrl: () => string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export function createLlamaCppModelGateway(options: LlamaCppModelGatewayOptions): LlamaCppModelGateway {
  let server: http.Server | null = null;
  let boundPort: number | null = null;

  return {
    baseUrl: () => (boundPort ? `http://${LOCAL_GATEWAY_HOST}:${boundPort}/v1` : null),
    start: async () => {
      if (server) return;
      const config = options.getConfig();
      const host =
        config.accessMode === LlamaCppGatewayAccessMode.Lan ? LAN_GATEWAY_HOST : LOCAL_GATEWAY_HOST;
      await new Promise<void>((resolve, reject) => {
        const nextServer = http.createServer((request, response) => {
          void handleGatewayRequest(request, response, options).catch(error => {
            const message = error instanceof Error ? error.message : 'Local model gateway failed.';
            writeJsonError(response, 502, message);
          });
        });
        nextServer.once('error', reject);
        nextServer.listen(config.port, host, () => {
          const address = nextServer.address();
          if (!address || typeof address === 'string') {
            nextServer.close();
            reject(new Error('Local model gateway did not expose a TCP port.'));
            return;
          }
          server = nextServer;
          boundPort = address.port;
          console.log(`[LlamaCppGateway] local model gateway started on ${host}:${boundPort}`);
          resolve();
        });
      });
    },
    stop: async () => {
      if (!server) return;
      const current = server;
      server = null;
      boundPort = null;
      await new Promise<void>((resolve, reject) => {
        current.close(error => (error ? reject(error) : resolve()));
      });
    },
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
  if (!isAuthorized(request, options.getConfig())) {
    writeJsonError(response, 401, 'A valid gateway bearer token is required.');
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

function isAuthorized(
  request: http.IncomingMessage,
  config: ReturnType<LlamaCppModelGatewayOptions['getConfig']>,
): boolean {
  if (config.accessMode !== LlamaCppGatewayAccessMode.Lan || isLoopbackRequest(request)) return true;
  const token = config.lanToken?.trim();
  return Boolean(token && request.headers.authorization === `Bearer ${token}`);
}

function isLoopbackRequest(request: http.IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
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
    response.statusCode = upstreamResponse.status;
    upstreamResponse.headers.forEach((value, key) => {
      if (key !== 'transfer-encoding') response.setHeader(key, value);
    });
    if (!upstreamResponse.body) {
      response.end();
      return;
    }
    const reader = upstreamResponse.body.getReader();
    while (!response.writableEnded) {
      const { done, value } = await reader.read();
      if (done) break;
      response.write(Buffer.from(value));
    }
    response.end();
  } finally {
    request.removeListener('aborted', abort);
    response.removeListener('close', abort);
  }
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
