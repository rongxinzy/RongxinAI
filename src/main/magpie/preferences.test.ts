import { expect, test } from 'vitest';

import { mergeMagpiePreferences, projectMagpiePreferences } from './preferences';

const raw = {
  version: '1.2.3',
  dir: '/home/user/.magpie',
  gateway: 'http://127.0.0.1:3425',
  proxy: '',
  proxyNow: 'http://system:8080',
  proxySource: 'system',
  bareModelIDs: false,
  port: 3425,
  lan: false,
  onNetwork: false,
  vision: '',
  visionAuto: 'openai/vision',
  visionEfforts: ['low', 'high'],
  visionEffort: 'low',
  visionModels: [
    { id: 'openai/vision', name: 'Vision', providerName: 'OpenAI' },
    { id: '', name: 'dropped' },
  ],
  imageGen: 'off',
  imageGenModels: [],
  searcher: '',
  searchEfforts: ['low'],
  searchChoices: [
    {
      id: 'openai',
      name: 'OpenAI',
      models: [{ id: 'openai/gpt', name: 'GPT', providerName: 'OpenAI' }],
    },
  ],
  searchRelays: ['relay'],
  disabledModels: ['provider/*'],
  redact: true,
  redactPersonal: true,
  redactKinds: { ip: true, home: false, bad: 'yes' },
  redactWords: ['secret'],
  noAccountDiscovery: false,
  noAccountsEnv: false,
  githubToken: 'must-not-leak',
  lanKey: 'must-not-leak',
};

test('projects only renderer-safe preference fields', () => {
  const preferences = projectMagpiePreferences(raw);
  expect(preferences.dataDir).toBe('/home/user/.model-service');
  expect(preferences.visionAuto).toBe('openai/vision');
  expect(preferences.visionModels).toEqual([
    { id: 'openai/vision', name: 'Vision', providerName: 'OpenAI' },
  ]);
  expect(preferences.searchChoices[0].models[0].id).toBe('openai/gpt');
  expect(preferences.redactKinds).toEqual({ ip: true, home: false });
  expect(preferences.disabledModels).toEqual(['provider/*']);
  expect(JSON.stringify(preferences)).not.toContain('must-not-leak');
});

test('merges only the supported patch and preserves secrets and host fields', () => {
  const merged = mergeMagpiePreferences(raw, {
    vision: 'openai/vision',
    disabledModels: ['provider/old', 'provider/new'],
    redactKinds: { ip: false },
  });
  expect(merged.vision).toBe('openai/vision');
  expect(merged.disabledModels).toEqual(['provider/old', 'provider/new']);
  expect(merged.redactKinds).toEqual({ ip: false });
  expect(merged.githubToken).toBe('must-not-leak');
  expect(merged.lanKey).toBe('must-not-leak');
  expect(merged.port).toBe(3425);
});

test('rejects unsupported or malformed patches', () => {
  expect(() => mergeMagpiePreferences(raw, { port: 4000 } as never)).toThrow(
    'Unsupported preference',
  );
  expect(() => mergeMagpiePreferences(raw, { disabledModels: ['ok', 1] } as never)).toThrow(
    'Invalid disabledModels',
  );
  expect(() => mergeMagpiePreferences(raw, { redactKinds: { ip: 'yes' } } as never)).toThrow(
    'Invalid redactKinds',
  );
});
