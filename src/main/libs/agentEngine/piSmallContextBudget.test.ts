import { expect, test } from 'vitest';
import type { Api, Model } from '@earendil-works/pi-ai';
import { clampMaxTokensToContext } from '@earendil-works/pi-ai/api/simple-options';
import { estimateContextTokens } from '../../../../node_modules/@earendil-works/pi-ai/dist/utils/estimate.js';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';

test.each([1024, 4096, 8192])(
  'shared provider budget preserves input/output room in a %i-token model',
  window => {
    const model: Model<Api> = {
      id: 'bounded',
      name: 'Bounded',
      api: 'openai-completions',
      provider: 'test',
      baseUrl: '',
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: false,
      contextWindow: window,
      maxTokens: 4096,
    };
    const input = normalizeContext({
      messages: [{ role: 'user', content: 'A legitimate request.', timestamp: 0 }],
    });
    const cap = clampMaxTokensToContext(model, input, model.maxTokens);
    expect(cap).toBeGreaterThan(0);
    expect(
      estimateContextTokens(input).tokens + cap + Math.min(4096, Math.ceil(window * 0.15)),
    ).toBeLessThanOrEqual(window);
    expect(() =>
      clampMaxTokensToContext(
        model,
        normalizeContext({
          messages: [{ role: 'user', content: 'x'.repeat(window * 8), timestamp: 0 }],
        }),
        100,
      ),
    ).toThrow('Context window exceeded');
  },
);
