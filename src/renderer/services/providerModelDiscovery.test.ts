import { describe, expect, test } from 'vitest';

import {
  DiscoveryCapabilitiesSource,
  ModelCapabilityStatus,
  ProviderModelDiscoveryErrorCode,
  ProviderModelOrigin,
} from '@shared/providers';

import {
  applyProviderModelDiscoveryResult,
  isCurrentProviderModelDiscoveryRequest,
  mergeDiscoveredProviderModels,
} from './providerModelDiscovery';

describe('mergeDiscoveredProviderModels', () => {
  test('adds missing IDs without replacing existing metadata or deleting models', () => {
    const existing = [
      {
        id: 'model-a',
        name: 'Custom A',
        origin: ProviderModelOrigin.Discovered,
        supportsImage: true,
        contextWindow: 128_000,
      },
      { id: 'local-only', name: 'Local only' },
    ];

    const result = mergeDiscoveredProviderModels(existing, [
      { id: 'model-a', displayName: 'Remote A' },
      { id: 'model-b', displayName: 'Remote B' },
    ]);

    expect(result).toEqual({
      models: [
        ...existing,
        { id: 'model-b', name: 'Remote B', origin: ProviderModelOrigin.Discovered },
      ],
      addedCount: 1,
      removedCount: 0,
      changed: true,
    });
    expect(result.models[0]).toBe(existing[0]);
  });

  test('merges against the latest draft after concurrent manual edits', () => {
    const latestDraft = [
      { id: 'model-a', name: 'Renamed while loading', origin: ProviderModelOrigin.User },
      { id: 'manual-model', name: 'Added while loading' },
    ];

    expect(
      mergeDiscoveredProviderModels(latestDraft, [
        { id: 'model-a', displayName: 'Remote A' },
        { id: 'model-b', displayName: 'Remote B' },
      ]).models,
    ).toEqual([
      ...latestDraft,
      { id: 'model-b', name: 'Remote B', origin: ProviderModelOrigin.Discovered },
    ]);
  });

  test('updates an existing context length from explicit discovery metadata', () => {
    const existing = [
      {
        id: 'model-a',
        name: 'Model A',
        contextWindow: 8192,
        capabilities: { toolCalling: ModelCapabilityStatus.Unsupported },
      },
    ];

    expect(
      mergeDiscoveredProviderModels(existing, [
        {
          id: 'model-a',
          contextWindow: 32768,
          maxTokens: 4096,
          capabilities: {
            toolCalling: ModelCapabilityStatus.Supported,
            imageInput: ModelCapabilityStatus.Supported,
            reasoning: ModelCapabilityStatus.Supported,
          },
        },
      ]).models,
    ).toEqual([
      {
        id: 'model-a',
        name: 'Model A',
        contextWindow: 32768,
        maxTokens: 4096,
        origin: ProviderModelOrigin.Discovered,
        supportsImage: true,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Unsupported,
          imageInput: ModelCapabilityStatus.Supported,
          reasoning: ModelCapabilityStatus.Supported,
        },
      },
    ]);
  });

  test('lets a runtime-probe verdict override a stale supported capability', () => {
    const existing = [
      {
        id: 'qwen3-vl',
        name: 'Qwen3 VL',
        supportsImage: true,
        capabilities: { imageInput: ModelCapabilityStatus.Supported },
      },
    ];

    const result = mergeDiscoveredProviderModels(existing, [
      {
        id: 'qwen3-vl',
        capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
        capabilitiesSource: DiscoveryCapabilitiesSource.RuntimeProbe,
      },
    ]);

    expect(result.changed).toBe(true);
    expect(result.models).toEqual([
      {
        id: 'qwen3-vl',
        name: 'Qwen3 VL',
        supportsImage: false,
        origin: ProviderModelOrigin.Discovered,
        capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
      },
    ]);
  });

  test('does not overwrite a stored capability verdict without a probe marker', () => {
    const existing = [
      {
        id: 'qwen3-vl',
        name: 'Qwen3 VL',
        supportsImage: true,
        origin: ProviderModelOrigin.Discovered,
        capabilities: { imageInput: ModelCapabilityStatus.Supported },
      },
    ];

    const result = mergeDiscoveredProviderModels(existing, [
      {
        id: 'qwen3-vl',
        capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
      },
    ]);

    expect(result.changed).toBe(false);
    expect(result.models[0]).toBe(existing[0]);
  });

  test('never lets a runtime probe downgrade an entry the user edited by hand', () => {
    const existing = [
      {
        id: 'qwen3-vl',
        name: 'Qwen3 VL',
        supportsImage: true,
        origin: ProviderModelOrigin.User,
        capabilities: { imageInput: ModelCapabilityStatus.Supported },
      },
    ];

    const result = mergeDiscoveredProviderModels(existing, [
      {
        id: 'qwen3-vl',
        capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
        capabilitiesSource: DiscoveryCapabilitiesSource.RuntimeProbe,
      },
    ]);

    expect(result.changed).toBe(false);
    expect(result.models[0]).toBe(existing[0]);
  });

  test('leaves the draft unchanged after a failed or empty discovery', () => {
    const existing = [{ id: 'model-a', name: 'Model A' }];
    const failed = applyProviderModelDiscoveryResult(existing, {
      success: false,
      code: ProviderModelDiscoveryErrorCode.Network,
      error: 'Network error',
    });
    const empty = applyProviderModelDiscoveryResult(existing, { success: true, models: [] });

    expect(failed.models).toBe(existing);
    expect(empty.models).toBe(existing);
    expect(failed.changed).toBe(false);
    expect(empty.changed).toBe(false);
  });

  test('prunes stale entries when the list mirrors the endpoint', () => {
    const existing = [
      { id: 'model-a', name: 'Current' },
      { id: 'stale-from-old-endpoint', name: 'Stale' },
      { id: 'legacy-entry', name: 'Legacy without origin' },
    ];

    const result = mergeDiscoveredProviderModels(
      existing,
      [
        { id: 'model-a', displayName: 'Current' },
        { id: 'model-b', displayName: 'Remote B' },
      ],
      { pruneMissing: true },
    );

    expect(result).toEqual({
      models: [
        { ...existing[0], origin: ProviderModelOrigin.Discovered },
        { id: 'model-b', name: 'Remote B', origin: ProviderModelOrigin.Discovered },
      ],
      addedCount: 1,
      removedCount: 2,
      changed: true,
    });
  });

  test('keeps user-origin entries missing from the response when pruning', () => {
    const existing = [
      { id: 'manual-model', name: 'Added by hand', origin: ProviderModelOrigin.User },
      { id: 'edited-model', name: 'Saved via the form', origin: ProviderModelOrigin.User },
    ];

    const result = mergeDiscoveredProviderModels(
      existing,
      [{ id: 'edited-model', displayName: 'Still deployed' }],
      { pruneMissing: true },
    );

    expect(result.models).toEqual(existing);
    expect(result.models[0]).toBe(existing[0]);
    expect(result.addedCount).toBe(0);
    expect(result.removedCount).toBe(0);
    expect(result.changed).toBe(false);
  });

  test('pruning still backfills discovery metadata on surviving entries', () => {
    const existing = [
      {
        id: 'model-a',
        name: 'Model A',
        contextWindow: 8192,
        capabilities: { toolCalling: ModelCapabilityStatus.Unsupported },
      },
    ];

    const result = mergeDiscoveredProviderModels(
      existing,
      [
        {
          id: 'model-a',
          contextWindow: 32768,
          capabilities: { imageInput: ModelCapabilityStatus.Supported },
        },
      ],
      { pruneMissing: true },
    );

    expect(result.models).toEqual([
      {
        id: 'model-a',
        name: 'Model A',
        contextWindow: 32768,
        supportsImage: true,
        origin: ProviderModelOrigin.Discovered,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Unsupported,
          imageInput: ModelCapabilityStatus.Supported,
        },
      },
    ]);
  });
});

test('rejects stale model discovery responses', () => {
  expect(isCurrentProviderModelDiscoveryRequest(2, 2, 'provider-a:key-1', 'provider-a:key-1')).toBe(
    true,
  );
  expect(isCurrentProviderModelDiscoveryRequest(1, 2, 'provider-a:key-1', 'provider-a:key-1')).toBe(
    false,
  );
  expect(isCurrentProviderModelDiscoveryRequest(2, 2, 'provider-a:key-1', 'provider-b:key-2')).toBe(
    false,
  );
});
