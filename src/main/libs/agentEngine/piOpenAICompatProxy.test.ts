import http from 'http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  convertOpenAIChatCompletionTextToSSEForPi,
  normalizeOpenAISSETextForPi,
  openAIStreamPayloadHasFinishReason,
  registerPiOpenAICompatTokenRefresher,
  registerPiOpenAICompatUpstream,
  remapDeveloperRolesForOpenAICompletions,
  stopPiOpenAICompatProxyForTests,
} from './piOpenAICompatProxy';

describe('piOpenAICompatProxy', () => {
  afterEach(async () => {
    await stopPiOpenAICompatProxyForTests();
  });

  it('remaps developer roles to system for gateway compatibility', () => {
    const body = Buffer.from(
      JSON.stringify({
        model: 'kimi-for-coding',
        stream: true,
        messages: [
          { role: 'developer', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello' },
        ],
      }),
      'utf8',
    );

    const remapped = remapDeveloperRolesForOpenAICompletions(body);

    const parsed = JSON.parse(remapped.toString('utf8')) as {
      stream?: boolean;
      messages: Array<{ role: string; content: string }>;
    };
    expect(parsed.messages.map(message => message.role)).toEqual(['system', 'user', 'assistant']);
    expect(parsed.stream).toBe(true);
    expect(parsed.messages[0].content).toBe('You are a helpful assistant.');
  });

  it('passes payloads without developer roles through unchanged', () => {
    const body = Buffer.from(
      JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      'utf8',
    );
    expect(remapDeveloperRolesForOpenAICompletions(body)).toEqual(body);
  });

  it('passes malformed payloads through unchanged', () => {
    const body = Buffer.from('not-json', 'utf8');
    expect(remapDeveloperRolesForOpenAICompletions(body)).toEqual(body);
  });
  it('detects OpenAI stream finish reasons', () => {
    expect(
      openAIStreamPayloadHasFinishReason(
        JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      ),
    ).toBe(true);
    expect(
      openAIStreamPayloadHasFinishReason(
        JSON.stringify({ choices: [{ index: 0, delta: { content: 'hello' } }] }),
      ),
    ).toBe(false);
  });

  it('injects a final finish_reason chunk before DONE when upstream omits it', () => {
    const normalized = normalizeOpenAISSETextForPi(
      ['data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}', '', 'data: [DONE]', ''].join(
        '\n',
      ),
      'agent-model',
    );

    expect(normalized).toContain('"finish_reason":"stop"');
    expect(normalized).toContain('"model":"agent-model"');
    expect(normalized.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('converts non-stream OpenAI chat completions into SSE when stream was requested', () => {
    const converted = convertOpenAIChatCompletionTextToSSEForPi(
      JSON.stringify({
        id: 'chatcmpl-test',
        model: 'agent-model',
        created: 123,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'hello',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'AskUserQuestion', arguments: '{}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      'fallback-model',
    );

    expect(converted).not.toBeNull();
    expect(converted).toContain('data: {');
    expect(converted).toContain('"content":"hello"');
    expect(converted).toContain('"tool_calls"');
    expect(converted).toContain('"finish_reason":"stop"');
    expect(converted?.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('does not inject another finish_reason when upstream already provides one', () => {
    const normalized = normalizeOpenAISSETextForPi(
      [
        'data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}',
        '',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
      'agent-model',
    );

    expect((normalized.match(/finish_reason/g) ?? []).length).toBe(1);
    expect(normalized).toContain('"finish_reason":"tool_calls"');
  });

  it('remaps developer roles to system before forwarding to the upstream', async () => {
    let receivedBody = '';
    const upstream = http.createServer(async (request, response) => {
      for await (const chunk of request) {
        receivedBody += chunk.toString('utf8');
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
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

  it('proxies upstream SSE and injects missing finish_reason through the local server', async () => {
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
      expect(text).toContain('"finish_reason":"stop"');
      expect(text.trim().endsWith('data: [DONE]')).toBe(true);
    } finally {
      await new Promise<void>(resolve => upstream.close(() => resolve()));
    }
  });

  it('protects managed upstream credentials with a per-process local capability', async () => {
    let upstreamRequestCount = 0;
    const upstream = http.createServer((_request, response) => {
      upstreamRequestCount += 1;
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
        },
        body: JSON.stringify({ model: 'zhiyuan-free', messages: [] }),
      });

      expect(unauthorized.status).toBe(401);
      expect(authorized.status).toBe(200);
      expect(upstreamRequestCount).toBe(1);
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
