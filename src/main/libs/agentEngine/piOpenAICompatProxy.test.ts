import { describe, expect, it } from 'vitest';

import {
  normalizeOpenAISSETextForPi,
  openAIStreamPayloadHasFinishReason,
} from './piOpenAICompatProxy';

describe('piOpenAICompatProxy', () => {
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
});
