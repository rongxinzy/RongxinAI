import { describe, it, expect } from 'vitest';
import { hostProviderPayload, type MagpieHostProvider } from './hostProviders';
const fixture: MagpieHostProvider = {
  id: 'zhiyuan-host-local',
  name: 'Local GPU',
  api: 'openai-completions',
  baseUrl: 'http://127.0.0.1:1234/v1',
  models: [{ id: 'qwen', contextWindow: 32000, maxTokens: 4000, input: ['text', 'image'] }],
};
describe('host-owned gateway providers', () => {
  it('serializes only local endpoints and declared model metadata', () => {
    expect(hostProviderPayload(fixture)).toMatchObject({
      id: fixture.id,
      chat: fixture.baseUrl,
      key: 'magpie-local',
      models: ['qwen'],
      contexts: { qwen: 32000 },
      outputs: { qwen: 4000 },
      modelPrefs: { qwen: { images: true } },
      proxy: 'direct',
    });
  });
  it.each([
    'https://cloud.test/v1',
    'http://127.0.0.1/v1',
    'http://user:secret@127.0.0.1:1234/v1',
    'http://127.0.0.1:1234/v1?token=x',
  ])('rejects nonlocal or credential-bearing endpoints %s', baseUrl => {
    expect(() => hostProviderPayload({ ...fixture, baseUrl })).toThrow('loopback');
  });
  it('cannot overwrite ordinary providers or invent unknown limits', () => {
    expect(() => hostProviderPayload({ ...fixture, id: 'openai' })).toThrow('id');
    expect(() =>
      hostProviderPayload({ ...fixture, models: [{ id: 'x', contextWindow: -1 }] }),
    ).toThrow('limit');
  });
});
