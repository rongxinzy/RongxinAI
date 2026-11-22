import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { isContextOverflow } from '@earendil-works/pi-ai/compat';
import { expect, test, vi } from 'vitest';
import { createLlamaCppModelGateway } from './llamacppModelGateway';

test('a failed upstream stream closes the response and releases its model lease', async () => {
  const stream = Promise.withResolvers<http.ServerResponse>();
  const upstream = http.createServer((_request, response) => {
    response.write('data: first chunk\n\n');
    stream.resolve(response);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Missing upstream port');

  const release = vi.fn();
  const gateway = createLlamaCppModelGateway({
    acquireModel: async () => ({ baseUrl: `http://127.0.0.1:${address.port}`, release }),
    listModels: () => [{ id: 'local' }],
    shutdownSignal: new AbortController().signal,
  });
  const request = new AbortController();
  try {
    await gateway.start(0);
    const response = await fetch(`${gateway.baseUrl()}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ model: 'local' }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(2_000)]),
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect(Buffer.from((await reader.read()).value!).toString()).toBe('data: first chunk\n\n');
    (await stream.promise).destroy();

    await expect(reader.read()).rejects.toThrow('terminated');
    expect(release).toHaveBeenCalledTimes(1);
    const subsequent = await fetch(`${gateway.baseUrl()}/models`);
    expect(await subsequent.json()).toMatchObject({ data: [{ id: 'local' }] });
  } finally {
    request.abort();
    upstream.closeAllConnections();
    upstream.close();
    await gateway.stop();
  }
});

test('retries a failed bind to the same port and closes the previous listener', async () => {
  const occupied = net.createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  const address = occupied.address();
  if (!address || typeof address === 'string') throw new Error('Missing reserved port');
  const gateway = createLlamaCppModelGateway({
    acquireModel: vi.fn(),
    listModels: () => [],
    shutdownSignal: new AbortController().signal,
  });
  try {
    await gateway.start(0);
    const oldUrl = gateway.baseUrl();
    await expect(gateway.start(address.port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(gateway.baseUrl()).toBeNull();
    await expect(fetch(`${oldUrl}/models`)).rejects.toThrow();

    occupied.close();
    await once(occupied, 'close');
    await gateway.start(address.port);
    expect(gateway.baseUrl()).toBe(`http://127.0.0.1:${address.port}/v1`);
    expect((await fetch(`${gateway.baseUrl()}/models`)).ok).toBe(true);
  } finally {
    if (occupied.listening) occupied.close();
    await gateway.stop();
  }
});

test.each(['before', 'during'])(
  'shutdown %s listener close drops an unfinished request',
  async timing => {
    const shutdown = new AbortController();
    const gateway = createLlamaCppModelGateway({
      acquireModel: vi.fn(),
      listModels: () => [],
      shutdownSignal: shutdown.signal,
    });
    await gateway.start(0);
    const url = new URL(gateway.baseUrl()!);
    const socket = net.connect(Number(url.port), url.hostname);
    const closed = once(socket, 'close');
    try {
      await once(socket, 'connect');
      const headersAccepted = once(socket, 'data');
      socket.write(
        'POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nExpect: 100-continue\r\nContent-Length: 100\r\n\r\n{',
      );
      expect(String((await headersAccepted)[0])).toContain('100 Continue');
      if (timing === 'before') shutdown.abort();
      const stop = gateway.stop();
      const stopped = vi.fn();
      void stop.then(stopped);
      if (timing === 'during') {
        await new Promise(resolve => setImmediate(resolve));
        expect(stopped).not.toHaveBeenCalled();
        shutdown.abort();
      }
      await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce(), { timeout: 500 });
      await closed;
    } finally {
      socket.destroy();
      await gateway.stop();
    }
  },
);

test('rewrites 500 llama.cpp context overflow errors to 400 and satisfies isContextOverflow', async () => {
  const upstream = http.createServer((_request, response) => {
    response.statusCode = 500;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: { message: 'Context size has been exceeded.' } }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Missing upstream port');

  const gateway = createLlamaCppModelGateway({
    acquireModel: async () => ({ baseUrl: `http://127.0.0.1:${address.port}`, release: vi.fn() }),
    listModels: () => [{ id: 'local' }],
    shutdownSignal: new AbortController().signal,
  });
  try {
    await gateway.start(0);
    const response = await fetch(`${gateway.baseUrl()}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ model: 'local' }),
    });
    expect(response.status).toBe(400);
    const text = await response.text();
    const parsed = JSON.parse(text) as { error: { message: string } };
    expect(
      isContextOverflow(
        {
          role: 'assistant',
          content: [],
          api: 'openai-completions',
          provider: 'magpie',
          model: 'local',
          stopReason: 'error',
          errorMessage: `500 ${parsed.error.message}`,
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
        32768,
      ),
    ).toBe(true);
  } finally {
    upstream.closeAllConnections();
    upstream.close();
    await gateway.stop();
  }
});

test('normalizes SSE mid-stream llama.cpp context overflow frames so isContextOverflow matches', async () => {
  const upstream = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      `data: ${JSON.stringify({ error: { message: 'Context size has been exceeded.' } })}\n\n`,
    );
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Missing upstream port');

  const gateway = createLlamaCppModelGateway({
    acquireModel: async () => ({ baseUrl: `http://127.0.0.1:${address.port}`, release: vi.fn() }),
    listModels: () => [{ id: 'local' }],
    shutdownSignal: new AbortController().signal,
  });
  try {
    await gateway.start(0);
    const response = await fetch(`${gateway.baseUrl()}/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ model: 'local' }),
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('exceeds the available context size');
    expect(
      isContextOverflow(
        {
          role: 'assistant',
          content: [],
          api: 'openai-completions',
          provider: 'magpie',
          model: 'local',
          stopReason: 'error',
          errorMessage: body,
          timestamp: Date.now(),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
        32768,
      ),
    ).toBe(true);
  } finally {
    upstream.closeAllConnections();
    upstream.close();
    await gateway.stop();
  }
});
