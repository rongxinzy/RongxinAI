import { timingSafeEqual } from 'crypto';
import http from 'http';

import { ENGRAM_LOOPBACK_HOST } from './constants';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export interface AuthenticatedEngramProxy {
  url: string;
  close: () => Promise<void>;
}

export interface CreateAuthenticatedEngramProxyOptions {
  backendPort: number;
  token: string;
}

function tokensMatch(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export function isAllowedEngramRequest(method = '', pathname = ''): boolean {
  if (method === 'GET' && pathname === '/health') return true;
  if (method === 'GET' && pathname === '/search') return true;
  if (method === 'GET' && pathname === '/observations/recent') return true;
  if (method === 'POST' && pathname === '/sessions') return true;
  if (method === 'POST' && /^\/sessions\/[^/]+\/end$/.test(pathname)) return true;
  if (method === 'POST' && pathname === '/observations') return true;
  if (method === 'PATCH' && /^\/observations\/\d+$/.test(pathname)) return true;
  if (method === 'DELETE' && /^\/observations\/\d+$/.test(pathname)) return true;
  return false;
}

export async function createAuthenticatedEngramProxy(
  options: CreateAuthenticatedEngramProxyOptions,
): Promise<AuthenticatedEngramProxy> {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${ENGRAM_LOOPBACK_HOST}`);
    const authorization = request.headers.authorization ?? '';
    const providedToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';

    if (!providedToken || !tokensMatch(options.token, providedToken)) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'authorization required' }));
      return;
    }
    if (!isAllowedEngramRequest(request.method, requestUrl.pathname)) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unsupported memory operation' }));
      return;
    }

    const declaredLength = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      response.writeHead(413, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'request body too large' }));
      return;
    }

    const upstreamHeaders = { ...request.headers };
    upstreamHeaders.host = `${ENGRAM_LOOPBACK_HOST}:${options.backendPort}`;
    upstreamHeaders.authorization = `Bearer ${options.token}`;
    const upstream = http.request(
      {
        host: ENGRAM_LOOPBACK_HOST,
        port: options.backendPort,
        method: request.method,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        headers: upstreamHeaders,
      },
      upstreamResponse => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.once('error', () => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'memory service unavailable' }));
    });
    request.pipe(upstream);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, ENGRAM_LOOPBACK_HOST, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Memory proxy did not bind to a TCP port.');
  }

  return {
    url: `http://${ENGRAM_LOOPBACK_HOST}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
