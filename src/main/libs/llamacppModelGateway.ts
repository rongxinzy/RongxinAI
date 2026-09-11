import http from 'node:http';

const GATEWAY_HOST = '127.0.0.1';
const GATEWAY_PATH_PREFIX = '/v1/';
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

type LlamaCppModelGatewayOptions = {
  acquireModel: (modelName: string) => Promise<() => void>;
  getUpstreamBaseUrl: () => string;
};

export type LlamaCppModelGateway = {
  baseUrl: () => string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

export function createLlamaCppModelGateway(options: LlamaCppModelGatewayOptions): LlamaCppModelGateway {
  let server: http.Server | null = null;
  let port: number | null = null;

  return {
    baseUrl: () => (port ? `http://${GATEWAY_HOST}:${port}/v1` : null),
    start: async () => {
      if (server) return;
      await new Promise<void>((resolve, reject) => {
        const nextServer = http.createServer((request, response) => {
          void handleGatewayRequest(request, response, options).catch(error => {
            const message = error instanceof Error ? error.message : 'Local model gateway failed.';
            writeJsonError(response, 502, message);
          });
        });
        nextServer.once('error', reject);
        nextServer.listen(0, GATEWAY_HOST, () => {
          const address = nextServer.address();
          if (!address || typeof address === 'string') {
            nextServer.close();
            reject(new Error('Local model gateway did not expose a TCP port.'));
            return;
          }
          server = nextServer;
          port = address.port;
          console.log(`[LlamaCppGateway] local model gateway started on port ${port}`);
          resolve();
        });
      });
    },
    stop: async () => {
      if (!server) return;
      const current = server;
      server = null;
      port = null;
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
  if (!isLoopbackHost(request.headers.host) || !request.url?.startsWith(GATEWAY_PATH_PREFIX)) {
    writeJsonError(response, 404, 'Route not found.');
    return;
  }
  if (request.method !== 'POST' || !request.url.startsWith('/v1/chat/completions')) {
    await forwardWithoutLease(request, response, options.getUpstreamBaseUrl());
    return;
  }

  const body = await readRequestBody(request);
  const modelName = getModelName(body);
  if (!modelName) {
    writeJsonError(response, 400, 'A local model name is required.');
    return;
  }

  const release = await options.acquireModel(modelName);
  try {
    await forwardRequest(request, response, options.getUpstreamBaseUrl(), body);
  } finally {
    release();
  }
}

async function forwardWithoutLease(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  upstreamBaseUrl: string,
): Promise<void> {
  const body = await readRequestBody(request);
  await forwardRequest(request, response, upstreamBaseUrl, body);
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
      body: body.length > 0 ? body : undefined,
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

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return true;
  const hostname = host.split(':')[0];
  return hostname === GATEWAY_HOST || hostname === 'localhost';
}

function writeJsonError(response: http.ServerResponse, status: number, message: string): void {
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ error: { message } }));
}
