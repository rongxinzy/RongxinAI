import http from 'http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  registerPiOpenAICompatTokenRefresher,
  registerPiOpenAICompatUpstream,
  remapDeveloperRolesForOpenAICompletions,
  stopPiOpenAICompatProxyForTests,
} from './piOpenAICompatProxy';

describe('piOpenAICompatProxy', () => {
  afterEach(async () => {
    await stopPiOpenAICompatProxyForTests();
  });

  it('rewrites a Kimi developer role to system and leaves other roles alone', () => {
    const body = Buffer.from(
      JSON.stringify({
        model: 'kimi-for-coding',
        messages: [
          { role: 'developer', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ],
      }),
      'utf8',
    );

    const remapped = JSON.parse(remapDeveloperRolesForOpenAICompletions(body).toString('utf8')) as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(remapped.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant']);
    expect(remapped.messages[0]?.content).toBe('You are a helpful assistant.');
    expect(
      remapDeveloperRolesForOpenAICompletions(Buffer.from('not-json', 'utf8')).toString(),
    ).toBe('not-json');
  });

  it('rewrites developer roles before forwarding a chat completion', async () => {
    let receivedBody = '';
    const upstream = http.createServer(async (request, response) => {
      for await (const chunk of request) {
        receivedBody += chunk.toString('utf8');
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            { index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' },
          ],
        }),
      );
    });
    const upstreamBaseURL = await new Promise<string>((resolve, reject) => {
      upstream.once('error', reject);
      upstream.listen(0, '127.0.0.1', () => {
        const address = upstream.address();
        if (!address || typeof address === 'string') {
          reject(new Error('upstream did not receive a TCP port'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });

    try {
      const proxyBaseURL = await registerPiOpenAICompatUpstream('custom_9', {
        baseURL: upstreamBaseURL,
        apiKey: 'sk-test',
      });
      const response = await fetch(`${proxyBaseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'agent-model',
          messages: [
            { role: 'developer', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Hi' },
          ],
        }),
      });
      expect(response.ok).toBe(true);

      const parsed = JSON.parse(receivedBody) as { messages: Array<{ role: string }> };
      expect(parsed.messages.map(message => message.role)).toEqual(['system', 'user']);
    } finally {
      upstream.close();
    }
  });

  it('does not forward the runtime API key to anonymous custom upstreams', async () => {
    let receivedAuthorization: string | undefined;
    const upstream = http.createServer((request, response) => {
      receivedAuthorization = request.headers.authorization;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [] }));
    });
    const upstreamBaseURL = await listen(upstream);

    try {
      const proxyBaseURL = await registerPiOpenAICompatUpstream('custom_8', {
        baseURL: upstreamBaseURL,
        forwardIncomingAuthorization: false,
      });
      const response = await fetch(`${proxyBaseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer runtime-placeholder',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: 'anonymous-model', messages: [] }),
      });

      expect(response.ok).toBe(true);
      expect(receivedAuthorization).toBeUndefined();
    } finally {
      await close(upstream);
    }
  });

  it('proxies upstream SSE bytes without injecting a finish reason', async () => {
    const upstream = http.createServer((request, response) => {
      expect(request.url).toBe('/v1/chat/completions');
      expect(request.headers.authorization).toBe('Bearer sk-test');
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      response.write('data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}\n\n');
      response.end('data: [DONE]\n\n');
    });

    const upstreamBaseURL = await new Promise<string>((resolve, reject) => {
      upstream.once('error', reject);
      upstream.listen(0, '127.0.0.1', () => {
        const address = upstream.address();
        if (!address || typeof address === 'string') {
          reject(new Error('upstream did not receive a TCP port'));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });

    try {
      const proxyBaseURL = await registerPiOpenAICompatUpstream('custom_9', {
        baseURL: upstreamBaseURL,
        apiKey: 'sk-test',
      });
      const response = await fetch(`${proxyBaseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'agent-model', stream: true, messages: [] }),
      });
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(text).toContain('"content":"hello"');
      expect(text).not.toContain('finish_reason');
      expect(text).toContain('data: [DONE]');
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  });

  it('protects managed upstream credentials with a per-process local capability', async () => {
    let upstreamRequestCount = 0;
    let forwardedWorkload: string | undefined;
    let forwardedConversationId: string | undefined;
    const upstream = http.createServer((request, response) => {
      upstreamRequestCount += 1;
      forwardedWorkload = request.headers['x-zhiyuan-workload'];
      forwardedConversationId = request.headers['x-zhiyuan-conversation-id'];
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [] }));
    });
    const upstreamBaseURL = await listen(upstream);

    try {
      const proxyBaseURL = await registerPiOpenAICompatUpstream('zhiyuan', {
        baseURL: upstreamBaseURL,
        apiKey: 'account-access-token',
        requiredIncomingApiKey: 'random-local-capability',
      });
      const unauthorized = await fetch(`${proxyBaseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'zhiyuan-free', messages: [] }),
      });
      const authorized = await fetch(`${proxyBaseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer random-local-capability',
          'content-type': 'application/json',
          'x-zhiyuan-conversation-id': 'work-session-1',
          'x-zhiyuan-workload': 'work',
        },
        body: JSON.stringify({ model: 'zhiyuan-free', messages: [] }),
      });

      expect(unauthorized.status).toBe(401);
      expect(authorized.status).toBe(200);
      expect(upstreamRequestCount).toBe(1);
      expect(forwardedWorkload).toBe('work');
      expect(forwardedConversationId).toBe('work-session-1');
    } finally {
      await close(upstream);
    }
  });

  it('refreshes a rejected provider token once and retries the request', async () => {
    const authorizations: Array<string | undefined> = [];
    const upstream = http.createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      if (request.headers.authorization === 'Bearer old-token') {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'expired token' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ index: 0, message: { content: 'refreshed' }, finish_reason: 'stop' }],
        }),
      );
    });
    const upstreamBaseURL = await listen(upstream);
    let refreshCount = 0;

    try {
      const proxyBaseURL = await registerPiOpenAICompatUpstream('custom_enterprise', {
        baseURL: upstreamBaseURL,
        apiKey: 'old-token',
      });
      registerPiOpenAICompatTokenRefresher('custom_enterprise', async () => {
        refreshCount += 1;
        return 'new-token';
      });

      const response = await fetch(`${proxyBaseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'enterprise-chat', messages: [] }),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('refreshed');
      expect(authorizations).toEqual(['Bearer old-token', 'Bearer new-token']);
      expect(refreshCount).toBe(1);
    } finally {
      await close(upstream);
    }
  });

  it('coalesces concurrent token refreshes and never retries more than once', async () => {
    let upstreamRequestCount = 0;
    const upstream = http.createServer((_request, response) => {
      upstreamRequestCount += 1;
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'rejected token' }));
    });
    const upstreamBaseURL = await listen(upstream);
    let refreshCount = 0;

    try {
      const proxyBaseURL = await registerPiOpenAICompatUpstream('custom_enterprise', {
        baseURL: upstreamBaseURL,
        apiKey: 'old-token',
      });
      registerPiOpenAICompatTokenRefresher('custom_enterprise', async () => {
        refreshCount += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
        return 'new-token';
      });
      const request = () =>
        fetch(`${proxyBaseURL}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'enterprise-chat', messages: [] }),
        });

      const responses = await Promise.all([request(), request()]);

      expect(responses.map(response => response.status)).toEqual([401, 401]);
      expect(refreshCount).toBe(1);
      expect(upstreamRequestCount).toBe(4);
    } finally {
      await close(upstream);
    }
  });

  it('forwards Anthropic messages byte-identically with bearer injection and no remap', async () => {
    let receivedBody = '';
    let receivedAuthorization: string | undefined;
    const upstream = http.createServer(async (request, response) => {
      expect(request.url).toBe('/bench-anthropic/v1/messages');
      receivedAuthorization = request.headers.authorization;
      for await (const chunk of request) {
        receivedBody += chunk.toString('utf8');
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'hi' }],
        }),
      );
    });
    const upstreamBaseURL = await listen(upstream);

    try {
      const proxyBaseURL = await registerPiOpenAICompatUpstream(
        'custom_enterprise#bench-anthropic',
        {
          baseURL: `${upstreamBaseURL}/bench-anthropic`,
          apiKey: 'managed-jwt',
        },
        { bareBaseUrl: true },
      );
      expect(proxyBaseURL.endsWith('/v1')).toBe(false);

      const payload = JSON.stringify({
        model: 'bench-anthropic',
        max_tokens: 1024,
        system: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'Hi' }],
      });
      const response = await fetch(`${proxyBaseURL}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });

      expect(response.ok).toBe(true);
      expect(receivedAuthorization).toBe('Bearer managed-jwt');
      expect(receivedBody).toBe(payload);
      const parsed = (await response.json()) as { type?: string };
      expect(parsed.type).toBe('message');
    } finally {
      await close(upstream);
    }
  });

  it('passes Anthropic SSE bytes through without OpenAI stream normalization', async () => {
    const ssePayload =
      'event: message_start\n' +
      'data: {"type":"message_start","message":{"id":"msg_1"}}\n\n' +
      'event: content_block_delta\n' +
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n' +
      'event: message_stop\n' +
      'data: {"type":"message_stop"}\n\n';
    const upstream = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      response.end(ssePayload);
    });
    const upstreamBaseURL = await listen(upstream);

    try {
      const proxyBaseURL = await registerPiOpenAICompatUpstream(
        'custom_enterprise#bench-anthropic',
        {
          baseURL: `${upstreamBaseURL}/bench-anthropic`,
          apiKey: 'managed-jwt',
        },
        { bareBaseUrl: true },
      );
      const response = await fetch(`${proxyBaseURL}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'bench-anthropic', stream: true, messages: [] }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(await response.text()).toBe(ssePayload);
    } finally {
      await close(upstream);
    }
  });

  it('passes a non-stream Anthropic JSON response through even when stream was requested', async () => {
    const jsonPayload = JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: 'end_turn',
    });
    const upstream = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(jsonPayload);
    });
    const upstreamBaseURL = await listen(upstream);

    try {
      const proxyBaseURL = await registerPiOpenAICompatUpstream(
        'custom_enterprise#bench-anthropic',
        {
          baseURL: `${upstreamBaseURL}/bench-anthropic`,
          apiKey: 'managed-jwt',
        },
        { bareBaseUrl: true },
      );
      const response = await fetch(`${proxyBaseURL}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'bench-anthropic', stream: true, messages: [] }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.text()).toBe(jsonPayload);
    } finally {
      await close(upstream);
    }
  });

  it('refreshes a per-model Anthropic upstream via the provider-level refresher and retries', async () => {
    const authorizations: Array<string | undefined> = [];
    const upstream = http.createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      if (request.headers.authorization === 'Bearer old-token') {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error' } }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'msg_1', type: 'message' }));
    });
    const upstreamBaseURL = await listen(upstream);
    let refreshCount = 0;

    try {
      const proxyBaseURL = await registerPiOpenAICompatUpstream(
        'custom_enterprise#bench-anthropic',
        {
          baseURL: `${upstreamBaseURL}/bench-anthropic`,
          apiKey: 'old-token',
        },
        { bareBaseUrl: true },
      );
      registerPiOpenAICompatTokenRefresher('custom_enterprise', async () => {
        refreshCount += 1;
        return 'new-token';
      });

      const response = await fetch(`${proxyBaseURL}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'bench-anthropic', messages: [] }),
      });

      expect(response.status).toBe(200);
      expect(authorizations).toEqual(['Bearer old-token', 'Bearer new-token']);
      expect(refreshCount).toBe(1);
    } finally {
      await close(upstream);
    }
  });
});

async function listen(server: http.Server): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('upstream did not receive a TCP port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()));
}
