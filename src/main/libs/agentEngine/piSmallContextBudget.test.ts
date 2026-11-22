import { expect, test } from 'vitest';
import type { Api, AssistantMessage, Model, TranscriptContext } from '@earendil-works/pi-ai';
import { contentText, createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options';
import { generateSummary, SettingsManager } from '@earendil-works/pi-coding-agent';
import { estimateContextTokens } from '../../../../node_modules/@earendil-works/pi-ai/dist/utils/estimate.js';
import { normalizeContext } from '../../../../node_modules/@earendil-works/pi-ai/dist/utils/transcript.js';

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

function summarize(
  selected: Model<Api>,
  text: string,
  observeRequest: (request: TranscriptContext) => boolean | void,
) {
  return generateSummary(
    [{ role: 'user', content: text, timestamp: 0 }],
    selected,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    (_model, request) => {
      const stream = createAssistantMessageEventStream();
      if (observeRequest(request)) {
        stream.push({
          type: 'error',
          reason: 'error',
          error: {
            ...response,
            content: [],
            stopReason: 'error',
            errorMessage: 'Context window exceeded',
          },
        });
      } else {
        stream.push({ type: 'done', reason: 'stop', message: response });
      }
      return stream;
    },
  );
}

test('native compaction defaults follow the model window and keep explicit settings', () => {
  const settings = SettingsManager.inMemory();
  const small = model(1024);
  expect(settings.getCompactionSettings(small)).toEqual({
    enabled: true,
    reserveTokens: 256,
    keepRecentTokens: 512,
  });
  expect(settings.getCompactionSettings(model(65_536)).reserveTokens).toBe(16_384);

  settings.applyOverrides({
    compaction: { reserveTokens: 64, modelOverrides: { 'test/test': { keepRecentTokens: 100 } } },
  });
  expect(settings.getCompactionSettings(small)).toEqual({
    enabled: true,
    reserveTokens: 64,
    keepRecentTokens: 100,
  });
});

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
    const result = await summarize(selected, 'A compact history with useful facts.', request => {
      calls.push(request);
      const cap = clampMaxTokensToContext(selected, request, selected.maxTokens);
      expect(estimateContextTokens(request).tokens + cap + fixedMargin).toBeLessThanOrEqual(window);
    });
    expect(calls).toHaveLength(1);
    expect(result).toBe('condensed');
  },
);

test('oversized summary keeps a midpoint identifier together when a word boundary exists', async () => {
  const inputs: string[] = [];
  const source = `${'a'.repeat(2000)} MARKER_ABCDEF ${'b'.repeat(2000)}`;
  await summarize(model(1024), source, request => {
    const message = request.messages.find(message => message.role === 'user');
    if (message) inputs.push(contentText(message.content));
  });
  expect(inputs.length).toBeGreaterThan(1);
  expect(inputs.some(input => input.includes('MARKER_ABCDEF'))).toBe(true);
});

test('summary splitting stops when the provider rejects a single newline', async () => {
  let newlineRequests = 0;
  await expect(
    summarize(model(8192), 'x\ny', request => {
      const input = request.messages.find(message => message.role === 'user')!;
      const text = contentText(input.content);
      const start = text.startsWith('This is a contiguous excerpt') ? text.indexOf('\n\n') + 2 : 0;
      const excerpt = text.slice(start, text.lastIndexOf('\n\nThe messages above'));
      if (excerpt === '\n') {
        expect(++newlineRequests).toBe(1);
        return true;
      }
      return excerpt.includes('>\n');
    }),
  ).rejects.toThrow('Summary instructions leave no room for source text in the model context');
  expect(newlineRequests).toBe(1);
});
