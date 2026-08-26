import { describe, expect, test, vi } from 'vitest';

import {
  ExternalModelAccessMode,
  ExternalModelProtocol,
  OPEN_EXTERNAL_MODEL_ACCESS_POLICY,
} from '../../shared/externalModels';
import { ModelCapabilityStatus } from '../../shared/providers';
import type { ExternalModelProvider } from './contract';
import { ExternalModelBridge } from './externalModelBridge';

describe('ExternalModelBridge', () => {
  test('registers, lists, resolves, and removes an external provider', async () => {
    let notifyChanged: (() => void) | null = null;
    const disposeChangeListener = vi.fn();
    const changed = vi.fn();
    const bridge = new ExternalModelBridge(vi.fn());
    bridge.onDidChange(changed);
    const provider = fixtureProvider({
      onDidChange: listener => {
        notifyChanged = listener;
        return disposeChangeListener;
      },
    });

    const unregister = bridge.registerProvider(provider);

    expect(bridge.accessPolicy()).toBe(OPEN_EXTERNAL_MODEL_ACCESS_POLICY);

    await expect(bridge.listModels()).resolves.toEqual([
      {
        id: 'assigned-model',
        displayName: 'Assigned Model',
        protocol: ExternalModelProtocol.OpenAICompatible,
        capabilities: { toolCalling: ModelCapabilityStatus.Supported },
        contextWindow: 128_000,
        isDefault: true,
        provider: { id: 'external.fixture', displayName: 'Fixture Gateway' },
      },
    ]);
    await expect(bridge.resolveModelRef('external.fixture/assigned-model')).resolves.toEqual({
      id: 'assigned-model',
      displayName: 'Assigned Model',
      protocol: ExternalModelProtocol.OpenAICompatible,
      capabilities: { toolCalling: ModelCapabilityStatus.Supported },
      contextWindow: 128_000,
      isDefault: true,
      provider: { id: 'external.fixture', displayName: 'Fixture Gateway' },
      connection: {
        baseUrl: 'https://gateway.example/v1',
        apiKey: 'short-lived-token',
        modelId: 'upstream-model',
      },
    });
    expect(provider.resolveConnection).toHaveBeenCalledWith('assigned-model');

    notifyChanged!();
    expect(changed).toHaveBeenCalledTimes(2);
    unregister();
    unregister();
    expect(disposeChangeListener).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledTimes(3);
    await expect(bridge.listModels()).resolves.toEqual([]);
  });

  test('isolates list failures and refuses malformed provider output', async () => {
    const logError = vi.fn();
    const bridge = new ExternalModelBridge(logError);
    bridge.registerProvider(fixtureProvider({ id: 'external.valid' }));
    bridge.registerProvider(
      fixtureProvider({
        id: 'external.broken',
        listModels: vi.fn(async () => [
          {
            id: '../escape',
            displayName: 'Invalid',
            protocol: ExternalModelProtocol.OpenAICompatible,
          },
        ]),
      }),
    );

    await expect(bridge.listModels()).resolves.toHaveLength(1);
    expect(logError).toHaveBeenCalledOnce();
    await expect(bridge.resolveModelRef('external.broken/escape')).rejects.toThrow(
      'model ID is invalid',
    );
  });

  test('validates provider identity, duplicate registration, and connections', async () => {
    const bridge = new ExternalModelBridge(vi.fn());
    expect(() => bridge.registerProvider(fixtureProvider({ id: 'openai' }))).toThrow(
      'provider ID is invalid',
    );
    bridge.registerProvider(fixtureProvider());
    expect(() => bridge.registerProvider(fixtureProvider())).toThrow('already registered');

    const invalidConnectionBridge = new ExternalModelBridge(vi.fn());
    invalidConnectionBridge.registerProvider(
      fixtureProvider({
        resolveConnection: vi.fn(async () => ({
          baseUrl: 'file:///secret',
          apiKey: 'token',
          modelId: 'upstream-model',
        })),
      }),
    );
    await expect(
      invalidConnectionBridge.resolveModelRef('external.fixture/assigned-model'),
    ).rejects.toThrow('base URL is invalid');
  });

  test('limits model access to exclusive providers and restores open access on disposal', async () => {
    const bridge = new ExternalModelBridge(vi.fn());
    bridge.registerProvider(
      fixtureProvider({
        id: 'external.optional',
        displayName: 'Optional Gateway',
      }),
    );
    const unregisterExclusive = bridge.registerProvider(
      fixtureProvider({
        id: 'external.managed',
        displayName: 'Managed Gateway',
        exclusive: true,
      }),
    );

    expect(bridge.accessPolicy()).toEqual({
      mode: ExternalModelAccessMode.Exclusive,
      providerIds: ['external.managed'],
    });
    await expect(bridge.listModels()).resolves.toEqual([
      expect.objectContaining({
        provider: { id: 'external.managed', displayName: 'Managed Gateway' },
      }),
    ]);
    expect(() => bridge.assertModelRefAllowed('external.managed/assigned-model')).not.toThrow();
    for (const modelRef of [
      undefined,
      '',
      'openai/gpt-5',
      'external.managed/',
      'external.optional/assigned-model',
    ]) {
      expect(() => bridge.assertModelRefAllowed(modelRef)).toThrow('managed model policy');
    }
    await expect(bridge.resolveModelRef('external.optional/assigned-model')).rejects.toThrow(
      'managed model policy',
    );

    unregisterExclusive();
    expect(bridge.accessPolicy()).toBe(OPEN_EXTERNAL_MODEL_ACCESS_POLICY);
    await expect(bridge.listModels()).resolves.toEqual([
      expect.objectContaining({
        provider: { id: 'external.optional', displayName: 'Optional Gateway' },
      }),
    ]);
  });

  test('keeps an exclusive provider closed when its managed catalog is empty', async () => {
    const bridge = new ExternalModelBridge(vi.fn());
    bridge.registerProvider(
      fixtureProvider({
        exclusive: true,
        listModels: vi.fn(async () => []),
      }),
    );

    expect(bridge.accessPolicy().mode).toBe(ExternalModelAccessMode.Exclusive);
    await expect(bridge.listModels()).resolves.toEqual([]);
    await expect(bridge.resolveModelRef('external.fixture/assigned-model')).rejects.toThrow(
      'unavailable',
    );
  });
});

function fixtureProvider(
  overrides: Partial<ExternalModelProvider> = {},
): ExternalModelProvider & { resolveConnection: ReturnType<typeof vi.fn> } {
  return {
    id: 'external.fixture',
    displayName: 'Fixture Gateway',
    listModels: vi.fn(async () => [
      {
        id: 'assigned-model',
        displayName: 'Assigned Model',
        protocol: ExternalModelProtocol.OpenAICompatible,
        capabilities: { toolCalling: ModelCapabilityStatus.Supported },
        contextWindow: 128_000,
        isDefault: true,
      },
    ]),
    resolveConnection: vi.fn(async () => ({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'short-lived-token',
      modelId: 'upstream-model',
    })),
    ...overrides,
  } as ExternalModelProvider & { resolveConnection: ReturnType<typeof vi.fn> };
}
