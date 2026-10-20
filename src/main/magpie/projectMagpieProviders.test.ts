import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildMagpieProviderSavePayload,
  projectMagpieProviderSummaries,
  projectSelectedProviderModelIds,
  resolveMagpieProviderSaveKey,
} from './projectMagpieProviders';

const upstreamFixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures/providers-state.json'), 'utf8'),
);

describe('projectMagpieProviderSummaries', () => {
  it('projects exposed model ids and key.set from upstream provider rows', () => {
    const list = projectMagpieProviderSummaries(upstreamFixture);
    expect(list).toHaveLength(3);
    const custom = list.find(p => p.id === 'custom-openai');
    expect(custom).toMatchObject({
      name: 'My OpenAI',
      models: ['gpt-4o', 'gpt-4o-mini'],
      hasKey: true,
      keyMasked: 'sk-…7890',
      isHostManaged: false,
    });
    const host = list.find(p => p.id === 'zhiyuan-host-enterprise');
    expect(host).toMatchObject({
      models: ['ent-1'],
      hasKey: false,
      keyMasked: 'system-managed',
      isHostManaged: true,
    });
    // Mask('none') is indistinguishable from Mask('abcd') in the pinned API.
    const legacy = list.find(p => p.id === 'keyless-none');
    expect(legacy).toMatchObject({ hasKey: true, keyMasked: '••••' });
  });

  it.each([false, true])('keeps real four-character keys set, optional=%s', optional => {
    const [provider] = projectMagpieProviderSummaries({
      providers: [{ id: 'short-key', key: { set: true, masked: '••••', optional } }],
    });
    expect(provider).toMatchObject({ hasKey: true, keyMasked: '••••' });
  });

  it('uses key.set even when a masked display value resembles the placeholder', () => {
    const [provider] = projectMagpieProviderSummaries({
      providers: [{ id: 'stored-key', key: { set: true, masked: 'none' } }],
    });
    expect(provider?.hasKey).toBe(true);
  });

  it('prefers chosen over catalog rows when upstream sends explicit picks', () => {
    const row = {
      chosen: ['picked-a'],
      models: [
        { id: 'picked-a', on: true },
        { id: 'catalog-b', on: true },
      ],
    };
    expect(projectSelectedProviderModelIds(row)).toEqual(['picked-a']);
  });
});

describe('resolveMagpieProviderSaveKey', () => {
  it('keeps stored keys on edit by sending a blank key and never sends none', () => {
    expect(resolveMagpieProviderSaveKey(undefined)).toBe('');
    expect(resolveMagpieProviderSaveKey('   ')).toBe('');
    expect(resolveMagpieProviderSaveKey('none')).toBe('');
    expect(resolveMagpieProviderSaveKey('sk-test-1234')).toBe('sk-test-1234');
  });
});

describe('buildMagpieProviderSavePayload', () => {
  it.each([undefined, '', '   ', 'none', ' none '])(
    'creates keyless LAN providers with the upstream sentinel for input %s',
    key => {
      const baseUrl = 'http://192.168.1.10:11434/v1';
      const input = {
        name: 'LAN Ollama',
        api: 'openai-completions' as const,
        baseUrl,
        key,
        models: ['local-model'],
      };
      const created = buildMagpieProviderSavePayload(input, undefined, 'lan', 'chat', baseUrl);
      expect(created).toMatchObject({ new: true, key: 'none', chat: baseUrl });
      expect(created).not.toHaveProperty('preset');

      const edited = buildMagpieProviderSavePayload(
        input,
        { id: 'lan', key: { set: true, masked: '••••' } },
        'lan',
        'chat',
        baseUrl,
      );
      expect(edited).toMatchObject({ new: false, key: '' });
    },
  );

  it.each([undefined, { id: 'lan', key: { set: true, masked: '••••' } }])(
    'sends an explicitly supplied real key when existing=%s',
    existing => {
      const baseUrl = 'http://192.168.1.10:8080/v1';
      const payload = buildMagpieProviderSavePayload(
        { name: 'LAN llama-server', api: 'openai-completions', baseUrl, key: ' abcd ' },
        existing,
        'lan',
        'chat',
        baseUrl,
      );
      expect(payload.key).toBe('abcd');
    },
  );

  it('omits placeholder keys and sends only explicit model picks', () => {
    const payload = buildMagpieProviderSavePayload(
      {
        name: 'Relay',
        api: 'openai-completions',
        baseUrl: 'http://127.0.0.1:1/v1',
        models: ['gpt-4o'],
      },
      { id: 'relay', off: false },
      'relay',
      'chat',
      'http://127.0.0.1:1/v1',
    );
    expect(payload.key).toBe('');
    expect(payload.models).toEqual(['gpt-4o']);
    expect(payload.new).toBe(false);
  });
});
