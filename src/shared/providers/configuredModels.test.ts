import { expect, test } from 'vitest';

import { ProviderModelConnectionTestStatus } from './connectionTest';
import { resolveConfiguredProviderModels } from './configuredModels';
import { ProviderModelOrigin, ProviderName, ProviderRegistry } from './constants';
import { ProviderModelPiApi } from './piRuntime';
import type { ProviderConfig } from './types';

type SavedModel = NonNullable<ProviderConfig['models']>[number];

const CONNECTION_TEST = {
  status: ProviderModelConnectionTestStatus.Success,
  signature: 'saved-connection-signature',
  testedAt: 1_800_000_000_000,
};

test('merges a tested coding model case-insensitively into one canonical entry', () => {
  const saved: SavedModel = {
    id: ' KIMI-FOR-CODING ',
    name: 'My coding model',
    origin: ProviderModelOrigin.User,
    connectionTest: CONNECTION_TEST,
    contextWindow: 1_048_576,
    maxTokens: 16_384,
    piRuntime: { api: ProviderModelPiApi.AnthropicMessages, reasoning: true },
  };

  const resolved = resolveConfiguredProviderModels(ProviderName.Moonshot, {
    codingPlanEnabled: true,
    models: [saved],
  });

  expect(resolved).toHaveLength(1);
  expect(resolved?.[0]).toMatchObject({ ...saved, id: 'kimi-for-coding' });
  expect(saved.id).toBe(' KIMI-FOR-CODING ');
});

test('retains successful connection metadata across coding-plan provider catalogs', () => {
  for (const providerName of [
    ProviderName.Moonshot,
    ProviderName.Qwen,
    ProviderName.Zhipu,
    ProviderName.Volcengine,
    ProviderName.Qianfan,
    ProviderName.Xiaomi,
  ]) {
    const catalog = ProviderRegistry.get(providerName)?.codingPlanModels;
    expect(catalog?.length).toBeGreaterThan(0);
    const firstModel = catalog![0];
    const saved: SavedModel = {
      id: firstModel.id,
      name: 'Outdated preset label',
      connectionTest: CONNECTION_TEST,
      contextWindow: 98_304,
      maxTokens: 8_192,
    };
    const resolved = resolveConfiguredProviderModels(providerName, {
      codingPlanEnabled: true,
      models: [saved],
    });

    expect(resolved?.map(model => model.id)).toEqual(catalog!.map(model => model.id));
    expect(resolved?.[0]).toMatchObject({
      ...saved,
      name: firstModel.name,
      connectionTest: CONNECTION_TEST,
    });
  }
});

test('drops untouched general presets while preserving endpoint extras and explicit provenance', () => {
  const extra: SavedModel = { id: 'endpoint-only-model', name: 'Endpoint model' };
  const generalModel: SavedModel = { id: 'KIMI-K2.6', name: 'General preset' };
  const untouched = resolveConfiguredProviderModels(ProviderName.Moonshot, {
    codingPlanEnabled: true,
    models: [generalModel, extra],
  });
  expect(untouched?.map(model => model.id)).toEqual(['kimi-for-coding', extra.id]);

  for (const evidence of [
    { origin: ProviderModelOrigin.User },
    { origin: ProviderModelOrigin.Discovered },
    { connectionTest: CONNECTION_TEST },
  ]) {
    const explicit = { ...generalModel, ...evidence };
    const resolved = resolveConfiguredProviderModels(ProviderName.Moonshot, {
      codingPlanEnabled: true,
      models: [explicit, extra],
    });
    expect(resolved).toHaveLength(3);
    expect(resolved).toContainEqual(explicit);
    expect(resolved).toContainEqual(extra);
  }
});

test('leaves ordinary provider configuration unchanged', () => {
  const models: SavedModel[] = [
    { id: 'my-model', name: 'Custom name', connectionTest: CONNECTION_TEST },
  ];

  expect(
    resolveConfiguredProviderModels(ProviderName.Moonshot, { models, codingPlanEnabled: false }),
  ).toBe(models);
  expect(
    resolveConfiguredProviderModels(ProviderName.OpenAI, { models, codingPlanEnabled: true }),
  ).toBe(models);
  expect(resolveConfiguredProviderModels(ProviderName.OpenAI, {})).toBeUndefined();
});
