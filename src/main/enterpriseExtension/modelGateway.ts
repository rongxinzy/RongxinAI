import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { ZhiyuanModelPoolHeader } from '../../shared/modelPool/constants';
import {
  matchesEnterpriseCapability,
  type ZhiyuanManagedProviderBridge,
} from './managedProviderBridge';

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const FORWARD_HEADER = 'x-zhiyuan-enterprise-forward';
const FORWARDED_HEADERS = [
  'anthropic-version',
  'anthropic-beta',
  'x-session-affinity',
  'x-session-id',
  'x-client-request-id',
  'session_id',
  ZhiyuanModelPoolHeader.ConversationId,
  ZhiyuanModelPoolHeader.Workload,
];

async function* boundedBody(request: IncomingMessage) {
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Enterprise request body exceeds its limit.');
    yield chunk as Buffer;
  }
}

export async function startEnterpriseModelGateway(bridge: ZhiyuanManagedProviderBridge) {
  const key = randomBytes(32).toString('hex');
  const server = createServer(async (request, response) => {
    const abort = new AbortController();
    response.once('close', () => abort.abort());
    try {
      const match = request.url?.match(/^\/([^/]+)(\/.*)$/);
      if (!match) {
        response.writeHead(404).end();
        return;
      }
      const [, providerId, route] = match;
      const credential =
        request.headers.authorization?.replace(/^Bearer /i, '') ?? request.headers['x-api-key'];
      const discovery = request.method === 'GET' && (route === '/models' || route === '/v1/models');
      const proof = request.headers[FORWARD_HEADER];
      if (
        typeof credential !== 'string' ||
        (!discovery && (typeof proof !== 'string' || !matchesEnterpriseCapability(proof, key)))
      ) {
        response.writeHead(403).end();
        return;
      }
      if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
        response.writeHead(413).end();
        return;
      }
      const target = await bridge.resolveTransport(providerId, credential);
      if (!target) {
        response.writeHead(403).end();
        return;
      }
      if (discovery) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ data: [{ id: target.modelId, object: 'model' }] }));
        return;
      }
      const anthropic = target.api === 'anthropic-messages';
      const upstreamPath = anthropic ? '/v1/messages' : '/chat/completions';
      const expectedPath = anthropic ? upstreamPath : `/v1${upstreamPath}`;
      if (request.method !== 'POST' || route !== expectedPath) {
        response.writeHead(404).end();
        return;
      }
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(anthropic
          ? { 'x-api-key': target.token }
          : { authorization: `Bearer ${target.token}` }),
      };
      for (const name of FORWARDED_HEADERS) {
        const value = request.headers[name];
        if (typeof value === 'string') headers[name] = value;
      }
      const signal = AbortSignal.any([abort.signal, target.signal, AbortSignal.timeout(600_000)]);
      signal.throwIfAborted();
      const url = new URL(target.baseUrl + upstreamPath);
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const outgoing = send(url, { method: 'POST', headers, signal });
      const reply = once(outgoing, 'response', { signal });
      // A streaming upload cannot be replayed when an upstream rejects its credentials.
      void pipeline(boundedBody(request), outgoing, { signal }).catch(() => {});
      const [upstream] = (await reply) as [IncomingMessage];
      for (const name of [
        'content-type',
        'content-encoding',
        'retry-after',
        'request-id',
        'x-request-id',
      ]) {
        const value = upstream.headers[name];
        if (value) response.setHeader(name, value);
      }
      response.writeHead(upstream.statusCode ?? 502);
      await pipeline(upstream, response, { signal });
    } catch {
      if (response.headersSent) response.destroy();
      else if (!response.destroyed) {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ error: { message: 'Enterprise model endpoint unavailable.' } }),
        );
      }
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Enterprise model gateway did not bind.');
  return {
    key,
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
