import { expect, test } from 'vitest';
import type { Api, AssistantMessage, Model, TranscriptContext } from '@earendil-works/pi-ai';
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options';
import { estimateContextTokens } from '../../../../node_modules/@earendil-works/pi-ai/dist/utils/estimate.js';
import { normalizeContext } from '../../../../node_modules/@earendil-works/pi-ai/dist/utils/transcript.js';
// The installed patched module does not publish declarations; exercise its actual runtime.
// @ts-expect-error upstream package does not provide a declaration for this internal module
import { completeBoundedSummary } from '../../../../node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/bounded-summary.js';

function context(text: string): TranscriptContext {
  return normalizeContext({ messages: [{ role: 'user', content: text, timestamp: 0 }] });
}

function model(window: number): Model<Api> {
  return {
    id: 'test',
    name: 'test',
    api: 'openai-completions',
    provider: 'test',
    baseUrl: '',
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: false,
    contextWindow: window,
    maxTokens: 4096,
  };
}

const response: AssistantMessage = {
  role: 'assistant',
  content: [{ type: 'text', text: 'condensed' }],
  api: 'openai-completions',
  provider: 'test',
  model: 'test',
  stopReason: 'stop',
  timestamp: 0,
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

test.each([1024, 4096, 8192])(
  'small context %i preserves room for input and output',
  async window => {
    const selected = model(window);
    const fixedMargin = Math.min(4096, Math.ceil(window * 0.15));
    const input = context('A short legitimate request.');
    const output = clampMaxTokensToContext(selected, input, selected.maxTokens);
    expect(output).toBeGreaterThan(0);
    expect(estimateContextTokens(input).tokens + output + fixedMargin).toBeLessThanOrEqual(window);
    expect(() => clampMaxTokensToContext(selected, context('x'.repeat(window * 8)), 100)).toThrow(
      'Context window exceeded',
    );

    const calls: TranscriptContext[] = [];
    const result: AssistantMessage = await completeBoundedSummary(
      selected,
      'A compact history with useful facts.',
      (text: string) => context(`Summarize this history: ${text}`),
      async (request: TranscriptContext) => {
        calls.push(request);
        const cap = clampMaxTokensToContext(selected, request, selected.maxTokens);
        expect(estimateContextTokens(request).tokens + cap + fixedMargin).toBeLessThanOrEqual(
          window,
        );
        return response;
      },
    );
    expect(calls).toHaveLength(1);
    expect(result.content).toEqual(response.content);
  },
);

test('oversized summary keeps a midpoint identifier together when a word boundary exists', async () => {
  const inputs: string[] = [];
  const source = `${'a'.repeat(2000)} MARKER_ABCDEF ${'b'.repeat(2000)}`;
  await completeBoundedSummary(
    model(1024),
    source,
    (text: string) => context(text),
    async (request: TranscriptContext) => {
      const message = request.messages[0];
      if (message.role === 'user' && typeof message.content === 'string')
        inputs.push(message.content);
      return response;
    },
  );
  expect(inputs.some(input => input.includes('MARKER_ABCDEF'))).toBe(true);
});
