import { expect, test, vi } from 'vitest';
import {
  createAssistantMessageEventStream,
  normalizeContext,
  type AssistantMessage,
  type Model,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi, isContextOverflow } from '@earendil-works/pi-ai/compat';
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

test('keeps tokenizer headroom when a local model advertises its full window as output ceiling', () => {
  const model = makeModel(65536, 65536);
  const context = makeContext('a'.repeat(41016 * 3.5));
  const estimatedInput = estimateContextTokens(context).tokens;
  const output = clampMagpieMaxTokensToContext(model, context, model.maxTokens);
  expect(output).toBeGreaterThan(4096);
  expect(estimatedInput + Math.ceil(estimatedInput * 0.15) + output).toBe(65536);
  // The stricter tokenizer fixture from oversized resume counts this request as 45,249 tokens.
  expect(45249 + output).toBeLessThanOrEqual(model.contextWindow);
  expect(clampMagpieMaxTokensToContext(model, makeContext('Hello'), 1024)).toBe(1024);
});

test('wrapMagpieNativeApi handles undefined mocks and prevents 1-token futile requests on overflow', async () => {
  expect(wrapMagpieNativeApi(undefined as never)).toBeUndefined();

  const innerStream = vi.fn();
  const innerStreamSimple = vi.fn((model, _context, options) => {
    const s = createAssistantMessageEventStream();
    expect(model.contextWindow).toBe(0);
    expect(model.maxTokens).toBe(options?.maxTokens);
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

test('wrapMagpieNativeApi enforces valid anthropic-messages thinking.budget_tokens and recovers when room is below 2048', async () => {
  type CapturedAnthropicBody = {
    max_tokens?: number;
    thinking?: { type?: string; budget_tokens?: number };
  };
  const capturedBodies: CapturedAnthropicBody[] = [];
  const captureFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(String(init?.body ?? '{}')) as CapturedAnthropicBody);
    return new Response(JSON.stringify({ error: { message: 'stopped in test' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  });

  const wrapped = wrapMagpieNativeApi(anthropicMessagesApi(), createAssistantMessageEventStream);
  const anthropicModel: Model<'anthropic-messages'> = {
    id: 'claude-small-window',
    name: 'Claude Small Window',
    api: 'anthropic-messages',
    provider: 'magpie',
    baseUrl: 'http://127.0.0.1:8080',
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: true,
    contextWindow: 4096,
    maxTokens: 4096,
  };

  // Insufficient output room (< 2048) must trigger context-overflow recovery without hitting fetch.
  for (const [chars, expectedInput, expectedSafe] of [
    [8750, 2500, 981],
    [7000, 2000, 1481],
    [5019, 1434, 2047],
  ] as const) {
    const tightContext = makeContext('a'.repeat(chars));
    expect(estimateContextTokens(tightContext).tokens).toBe(expectedInput);
    expect(
      clampMagpieMaxTokensToContext(anthropicModel, tightContext, anthropicModel.maxTokens),
    ).toBe(expectedSafe);
    const result = await wrapped
      .streamSimple(anthropicModel, tightContext, {
        apiKey: 'test-key',
        reasoning: 'medium',
        fetch: captureFetch as unknown as typeof fetch,
      })
      .result();
    expect(result.stopReason).toBe('error');
    expect(isContextOverflow(result, 4096)).toBe(true);
  }
  expect(captureFetch).not.toHaveBeenCalled();

  // Sufficient room (>= 2048) must satisfy 1024 <= budget_tokens < max_tokens on the real request body.
  const exactBoundaryContext = makeContext('a'.repeat(5015));
  expect(estimateContextTokens(exactBoundaryContext).tokens).toBe(1433);
  await wrapped
    .streamSimple(anthropicModel, exactBoundaryContext, {
      apiKey: 'test-key',
      reasoning: 'medium',
      fetch: captureFetch as unknown as typeof fetch,
    })
    .result();
  expect(capturedBodies[0]?.max_tokens).toBe(2048);
  expect(capturedBodies[0]?.thinking?.budget_tokens).toBe(1024);

  const mediumContext = makeContext('a'.repeat(3500));
  expect(estimateContextTokens(mediumContext).tokens).toBe(1000);
  await wrapped
    .streamSimple(anthropicModel, mediumContext, {
      apiKey: 'test-key',
      reasoning: 'medium',
      fetch: captureFetch as unknown as typeof fetch,
    })
    .result();
  expect(capturedBodies[1]?.max_tokens).toBe(2481);
  expect(capturedBodies[1]?.thinking?.budget_tokens).toBe(1457);

  for (const body of capturedBodies) {
    const budget = body.thinking?.budget_tokens;
    expect(budget).toBeTypeOf('number');
    expect(budget!).toBeGreaterThanOrEqual(1024);
    expect(budget!).toBeLessThan(body.max_tokens!);
  }

  // Adaptive thinking has no fixed budget floor and continues using proportional output clamping.
  const adaptiveModel: Model<'anthropic-messages'> = {
    ...anthropicModel,
    compat: { forceAdaptiveThinking: true },
  };
  await wrapped
    .streamSimple(adaptiveModel, makeContext('a'.repeat(8750)), {
      apiKey: 'test-key',
      reasoning: 'medium',
      fetch: captureFetch as unknown as typeof fetch,
    })
    .result();
  expect(capturedBodies[2]?.max_tokens).toBe(981);
  expect(capturedBodies[2]?.thinking).toMatchObject({ type: 'adaptive' });
  expect(capturedBodies[2]?.thinking?.budget_tokens).toBeUndefined();

  // Static model output ceiling (< 2048) or window (< 2048 even at zero input) cannot be fixed by compaction.
  const callCountBeforeStaticChecks = captureFetch.mock.calls.length;
  const lowMaxTokensModel: Model<'anthropic-messages'> = {
    ...anthropicModel,
    id: 'claude-low-max',
    contextWindow: 65536,
    maxTokens: 1536,
  };
  const lowMaxResult = await wrapped
    .streamSimple(lowMaxTokensModel, makeContext('a'), {
      apiKey: 'test-key',
      reasoning: 'medium',
      fetch: captureFetch as unknown as typeof fetch,
    })
    .result();
  expect(lowMaxResult.stopReason).toBe('error');
  expect(lowMaxResult.errorMessage).toContain('2048');
  expect(lowMaxResult.errorMessage).toContain('1536');
  expect(isContextOverflow(lowMaxResult, 65536)).toBe(false);

  const tinyWindowModel: Model<'anthropic-messages'> = {
    ...anthropicModel,
    id: 'claude-tiny-window',
    contextWindow: 2048,
    maxTokens: 4096,
  };
  const tinyWindowResult = await wrapped
    .streamSimple(tinyWindowModel, makeContext('a'), {
      apiKey: 'test-key',
      reasoning: 'medium',
      fetch: captureFetch as unknown as typeof fetch,
    })
    .result();
  expect(tinyWindowResult.stopReason).toBe('error');
  expect(tinyWindowResult.errorMessage).toContain('2048');
  expect(isContextOverflow(tinyWindowResult, 2048)).toBe(false);
  expect(captureFetch).toHaveBeenCalledTimes(callCountBeforeStaticChecks);
});
