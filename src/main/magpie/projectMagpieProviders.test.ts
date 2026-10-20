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
    const keyless = list.find(p => p.id === 'keyless-none');
    expect(keyless).toMatchObject({ hasKey: false });
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
    expect(resolveMagpieProviderSaveKey({ id: 'p1' }, undefined)).toBe('');
    expect(resolveMagpieProviderSaveKey({ id: 'p1' }, '   ')).toBe('');
    expect(resolveMagpieProviderSaveKey({ id: 'p1' }, 'none')).toBe('');
    expect(resolveMagpieProviderSaveKey(undefined, 'sk-test-1234')).toBe('sk-test-1234');
    expect(resolveMagpieProviderSaveKey(undefined, undefined)).toBe('');
  });
});

describe('buildMagpieProviderSavePayload', () => {
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
