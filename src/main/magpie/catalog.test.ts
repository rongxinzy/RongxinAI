import { describe, it, expect } from 'vitest';
import { projectMagpieCatalog } from './catalog';
import { readBoundedCatalog } from './catalogReader';
describe('public gateway catalog', () => {
  it('preserves native protocol, limits, reasoning and vision without secrets', () => {
    expect(
      projectMagpieCatalog({
        data: [
          {
            id: 'anthropic/claude',
            owned_by: 'anthropic',
            display_name: 'Claude',
            apiKey: 'secret',
            headers: { Authorization: 'secret' },
            native_endpoints: ['/v1/messages', 'https://evil.test'],
            context_window: 200000,
            max_output_tokens: 32000,
            supported_reasoning_levels: [{ effort: 'high' }],
            modalities: { input: ['text', 'image'], output: ['text'] },
          },
        ],
      }),
    ).toEqual([
      {
        id: 'anthropic/claude',
        owned_by: 'anthropic',
        display_name: 'Claude',
        native_endpoints: ['/v1/messages'],
        context_window: 200000,
        max_output_tokens: 32000,
        reasoning: true,
        supported_reasoning_levels: [{ effort: 'high' }],
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
    ]);
  });
  it('rejects duplicate ids and filters non-chat models/malformed rows', () => {
    expect(() => projectMagpieCatalog({ data: [{ id: 'x' }, { id: 'x' }] })).toThrow('Duplicate');
    expect(
      projectMagpieCatalog({
        data: [
          null,
          'x',
          {},
          { id: 'image', kind: 'image' },
          { id: 'audio', modalities: { output: ['audio'] } },
        ],
      }),
    ).toEqual([]);
  });
  it('does not turn invalid metadata into false precise limits', () => {
    const [model] = projectMagpieCatalog({
      data: [{ id: 'x', context_window: -1, max_output_tokens: Infinity, reasoning: 'yes' }],
    });
    expect(model.context_window).toBeUndefined();
    expect(model.max_output_tokens).toBeUndefined();
    expect(model.reasoning).toBe(false);
  });
  it('bounds the response while streaming before JSON parse', async () => {
    await expect(
      readBoundedCatalog(new Response('x'.repeat(2_000_001)), new AbortController().signal),
    ).rejects.toThrow('size limit');
    expect(
      new TextDecoder().decode(
        await readBoundedCatalog(new Response('{"data":[]}'), new AbortController().signal),
      ),
    ).toBe('{"data":[]}');
  });
});
