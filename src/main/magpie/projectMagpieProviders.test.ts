import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { projectMagpieProviderSummaries } from './projectMagpieProviders';

const upstreamFixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures/providers-state.json'), 'utf8'),
);

describe('projectMagpieProviderSummaries', () => {
  it('projects model ids and key.set from upstream provider rows', () => {
    const list = projectMagpieProviderSummaries(upstreamFixture);
    expect(list).toHaveLength(2);
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
  });
});
