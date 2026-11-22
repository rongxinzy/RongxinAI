import { expect, test, vi } from 'vitest';
import {
  createAssistantMessageEventStream,
  normalizeContext,
  type AssistantMessage,
  type Model,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { isContextOverflow } from '@earendil-works/pi-ai/compat';
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate';
import {
  clampMagpieMaxTokensToContext,
  normalizeContextOverflowErrorMessage,
  wrapMagpieNativeApi,
} from './piMagpieApiGuard';

function makeContext(text: string): TranscriptContext {
  return normalizeContext({ messages: [{ role: 'user', content: text, timestamp: 0 }] });
}

function makeModel(window: number, maxTokens = 4096): Model<'openai-completions'> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'openai-completions',
    provider: 'magpie',
    baseUrl: 'http://127.0.0.1:8080/v1',
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: window,
    maxTokens,
  };
}

function makeAssistantError(errorMessage: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'magpie',
    model: 'test-model',
    stopReason: 'error',
    errorMessage,
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

test.each([1024, 4096, 8192, 32768])(
  'clampMagpieMaxTokensToContext scales reserve margin on %i-token window and throws when exhausted',
  window => {
    const selected = makeModel(window);
    const fixedMargin = Math.min(4096, Math.ceil(window * 0.15));
    const modestInput = makeContext('A short legitimate request.');
    const output = clampMagpieMaxTokensToContext(selected, modestInput, selected.maxTokens);

    expect(output).toBeGreaterThan(1);
    expect(estimateContextTokens(modestInput).tokens + output + fixedMargin).toBeLessThanOrEqual(
      window,
    );
    expect(() =>
      clampMagpieMaxTokensToContext(selected, makeContext('x'.repeat(window * 8)), 100),
    ).toThrow('Context window exceeded');
  },
);

test('normalizeContextOverflowErrorMessage makes llama.cpp error match isContextOverflow idempotently', () => {
  const normalized = normalizeContextOverflowErrorMessage('Context size has been exceeded.');
  expect(normalized).toContain('exceeds the available context size');
  expect(normalizeContextOverflowErrorMessage(normalized)).toBe(normalized);
  expect(isContextOverflow(makeAssistantError(normalized), 32768)).toBe(true);
});

test('wrapMagpieNativeApi handles undefined mocks and prevents 1-token futile requests on overflow', async () => {
  expect(wrapMagpieNativeApi(undefined as never)).toBeUndefined();

  const innerStream = vi.fn();
  const innerStreamSimple = vi.fn((model, _context, options) => {
    const s = createAssistantMessageEventStream();
    expect(model.contextWindow).toBe(0);
    expect(options?.maxTokens).toBeGreaterThan(100);
    s.push({
      type: 'error',
      reason: 'error',
      error: makeAssistantError('Context size has been exceeded.'),
    });
    s.end();
    return s;
  });
  const wrapped = wrapMagpieNativeApi({
    stream: innerStream,
    streamSimple: innerStreamSimple,
  });

  // Exhausted input fails immediately without invoking inner streamSimple.
  const overflowStream = wrapped.streamSimple(makeModel(1024), makeContext('x'.repeat(8192)));
  const overflowResult = await overflowStream.result();
  expect(innerStreamSimple).not.toHaveBeenCalled();
  expect(overflowResult.stopReason).toBe('error');
  expect(isContextOverflow(overflowResult, 1024)).toBe(true);

  // Modest input on small 1024-token window keeps output > 100 and normalizes stream error.
  const smallStream = wrapped.streamSimple(makeModel(1024), makeContext('Hello'));
  const smallResult = await smallStream.result();
  expect(innerStreamSimple).toHaveBeenCalledOnce();
  expect(smallResult.errorMessage).toContain('exceeds the available context size');
  expect(isContextOverflow(smallResult, 1024)).toBe(true);
});

test('wrapMagpieNativeApi rewrites 5xx llama.cpp overflow fetch responses to 400 and preserves unrelated 502s', async () => {
  const capturedStatuses: number[] = [];
  const wrapped = wrapMagpieNativeApi({
    stream: vi.fn((_m, _ctx, opts) => {
      const s = createAssistantMessageEventStream();
      void (async () => {
        const overflowRes = await opts!.fetch!('http://127.0.0.1/overflow');
        capturedStatuses.push(overflowRes.status);
        const gatewayErrRes = await opts!.fetch!('http://127.0.0.1/bad-gateway');
        capturedStatuses.push(gatewayErrRes.status);
        s.end(makeAssistantError(await overflowRes.text()));
      })();
      return s;
    }),
    streamSimple: vi.fn(),
  });

  const mockFetch = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes('/overflow')) {
      return new Response(
        JSON.stringify({ error: { message: 'Context size has been exceeded.' } }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        },
      );
    }
    return new Response('Bad Gateway', { status: 502 });
  });

  const result = await wrapped
    .stream(makeModel(32768), makeContext('Hi'), { fetch: mockFetch as typeof fetch })
    .result();
  expect(capturedStatuses).toEqual([400, 502]);
  expect(isContextOverflow(result, 32768)).toBe(true);
});
