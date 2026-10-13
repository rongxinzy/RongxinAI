import { describe, expect, test } from 'vitest';

import type { Model } from './modelSlice';
import modelReducer, {
  clearAgentSelectedModel,
  pruneUnconfiguredSelectedModels,
  selectAgentSelectedModel,
  setAvailableModels,
  setDefaultSelectedModel,
  setSelectedModel,
} from './modelSlice';

const modelA: Model = { id: 'gpt-4o', name: 'GPT-4o', providerKey: 'openai' };
const modelB: Model = { id: 'glm-5.1', name: 'GLM 5.1', providerKey: 'zhipu' };
const modelC: Model = { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', providerKey: 'anthropic' };
function makeState(overrides?: Partial<ReturnType<typeof modelReducer>>) {
  const base = modelReducer(undefined, { type: 'init' });
  return { ...base, ...overrides };
}

describe('setSelectedModel', () => {
  test('writes per-agent model to map', () => {
    const state = modelReducer(undefined, setSelectedModel({ agentId: 'agent-1', model: modelA }));
    expect(state.selectedModelByAgent['agent-1']).toEqual(modelA);
  });

  test('overwrites existing per-agent model', () => {
    let state = modelReducer(undefined, setSelectedModel({ agentId: 'agent-1', model: modelA }));
    state = modelReducer(state, setSelectedModel({ agentId: 'agent-1', model: modelB }));
    expect(state.selectedModelByAgent['agent-1']).toEqual(modelB);
  });

  test('independent per-agent entries', () => {
    let state = modelReducer(undefined, setSelectedModel({ agentId: 'agent-1', model: modelA }));
    state = modelReducer(state, setSelectedModel({ agentId: 'agent-2', model: modelB }));
    expect(state.selectedModelByAgent['agent-1']).toEqual(modelA);
    expect(state.selectedModelByAgent['agent-2']).toEqual(modelB);
  });
});

describe('setDefaultSelectedModel', () => {
  test('sets app-level default model', () => {
    const state = modelReducer(undefined, setDefaultSelectedModel(modelB));
    expect(state.defaultSelectedModel).toEqual(modelB);
  });
});

describe('clearAgentSelectedModel', () => {
  test('removes agent entry from map', () => {
    let state = modelReducer(undefined, setSelectedModel({ agentId: 'agent-1', model: modelA }));
    state = modelReducer(state, clearAgentSelectedModel('agent-1'));
    expect(state.selectedModelByAgent['agent-1']).toBeUndefined();
  });

  test('no-op for non-existent agent', () => {
    const state = modelReducer(undefined, clearAgentSelectedModel('non-existent'));
    expect(Object.keys(state.selectedModelByAgent)).toHaveLength(0);
  });
});

describe('setAvailableModels', () => {
  test('re-matches per-agent models when available models change', () => {
    // Set up: agent has modelA selected
    let state = modelReducer(undefined, setSelectedModel({ agentId: 'agent-1', model: modelA }));

    // Update available models — modelA still present but with updated name
    const updatedModelA: Model = { ...modelA, name: 'GPT-4o (Updated)' };
    state = modelReducer(state, setAvailableModels([updatedModelA, modelB]));

    expect(state.selectedModelByAgent['agent-1'].name).toBe('GPT-4o (Updated)');
  });

  test('keeps the per-agent model when it is temporarily unavailable', () => {
    let state = modelReducer(undefined, setSelectedModel({ agentId: 'agent-1', model: modelA }));

    // A refresh where modelA disappears (e.g. hidden by the connection test
    // gate) must not drop the user's selection: it is restored once the model
    // is back in the list.
    state = modelReducer(state, setAvailableModels([modelB, modelC]));
    expect(state.selectedModelByAgent['agent-1']).toEqual(modelA);

    state = modelReducer(state, setAvailableModels([modelA, modelB]));
    expect(state.selectedModelByAgent['agent-1']).toEqual(modelA);
  });

  test('re-matches defaultSelectedModel', () => {
    let state = modelReducer(undefined, setDefaultSelectedModel(modelA));
    const updatedModelA: Model = { ...modelA, supportsImage: true };
    state = modelReducer(state, setAvailableModels([updatedModelA, modelB]));

    expect(state.defaultSelectedModel.supportsImage).toBe(true);
  });

  test('keeps defaultSelectedModel when it is temporarily missing from the list', () => {
    let state = modelReducer(undefined, setDefaultSelectedModel(modelA));

    state = modelReducer(state, setAvailableModels([modelB, modelC]));
    expect(state.defaultSelectedModel).toEqual(modelA);

    // The default is re-matched (with fresh metadata) once the model returns.
    const updatedModelA: Model = { ...modelA, supportsImage: true };
    state = modelReducer(state, setAvailableModels([updatedModelA, modelB]));
    expect(state.defaultSelectedModel).toEqual(updatedModelA);
  });
});

describe('pruneUnconfiguredSelectedModels', () => {
  test('drops selections whose model was deleted from the stored config', () => {
    let state = modelReducer(undefined, setSelectedModel({ agentId: 'agent-1', model: modelA }));
    state = modelReducer(state, setSelectedModel({ agentId: 'agent-2', model: modelB }));

    state = modelReducer(state, pruneUnconfiguredSelectedModels(['zhipu::glm-5.1']));

    expect(state.selectedModelByAgent['agent-1']).toBeUndefined();
    expect(state.selectedModelByAgent['agent-2']).toEqual(modelB);
  });

  test('keeps hidden-but-configured selections', () => {
    let state = modelReducer(undefined, setSelectedModel({ agentId: 'agent-1', model: modelA }));

    state = modelReducer(state, pruneUnconfiguredSelectedModels(['openai::gpt-4o']));

    expect(state.selectedModelByAgent['agent-1']).toEqual(modelA);
  });

  test('keeps selections backed by dynamic sources or no provider key', () => {
    const local: Model = { id: 'qwen3-32b', name: 'Qwen3 32B', providerKey: 'llamacpp' };
    const managed: Model = { id: 'free-model', name: 'Free', providerKey: 'zhiyuan' };
    const legacy: Model = { id: 'legacy-model', name: 'Legacy' };
    let state = modelReducer(undefined, setSelectedModel({ agentId: 'agent-1', model: local }));
    state = modelReducer(state, setSelectedModel({ agentId: 'agent-2', model: managed }));
    state = modelReducer(state, setSelectedModel({ agentId: 'agent-3', model: legacy }));

    state = modelReducer(state, pruneUnconfiguredSelectedModels([]));

    expect(state.selectedModelByAgent['agent-1']).toEqual(local);
    expect(state.selectedModelByAgent['agent-2']).toEqual(managed);
    expect(state.selectedModelByAgent['agent-3']).toEqual(legacy);
  });

  test('resets a dangling defaultSelectedModel when its provider is deleted', () => {
    // The default feeds every agent without an override, so a deleted provider
    // must not leave it pointing at a phantom model for the rest of the session.
    let state = makeState({
      availableModels: [modelA, modelB],
      defaultSelectedModel: modelB,
    });

    state = modelReducer(state, pruneUnconfiguredSelectedModels(['openai::gpt-4o']));

    expect(state.defaultSelectedModel).toEqual(modelA);
  });

  test('keeps a hidden-but-configured defaultSelectedModel', () => {
    let state = makeState({
      availableModels: [modelA],
      defaultSelectedModel: modelB,
    });

    state = modelReducer(
      state,
      pruneUnconfiguredSelectedModels(['openai::gpt-4o', 'zhipu::glm-5.1']),
    );

    expect(state.defaultSelectedModel).toEqual(modelB);
  });
});

describe('selectAgentSelectedModel', () => {
  test('returns per-agent override when present', () => {
    const state = makeState({
      selectedModelByAgent: { 'agent-1': modelA },
      availableModels: [modelA, modelB],
      defaultSelectedModel: modelB,
    });

    const result = selectAgentSelectedModel(state, 'agent-1', '');
    expect(result).toEqual(modelA);
  });

  test('resolves from agent model ref when no override', () => {
    const state = makeState({
      selectedModelByAgent: {},
      availableModels: [modelA, modelB],
      defaultSelectedModel: modelB,
    });

    const result = selectAgentSelectedModel(state, 'agent-1', 'openai/gpt-4o');
    expect(result.id).toBe('gpt-4o');
  });

  test('falls back to defaultSelectedModel when agent model is empty', () => {
    const state = makeState({
      selectedModelByAgent: {},
      availableModels: [modelA, modelB],
      defaultSelectedModel: modelB,
    });

    const result = selectAgentSelectedModel(state, 'agent-1', '');
    expect(result).toEqual(modelB);
  });

  test('falls back to defaultSelectedModel when agent model ref is invalid', () => {
    const state = makeState({
      selectedModelByAgent: {},
      availableModels: [modelA, modelB],
      defaultSelectedModel: modelB,
    });

    const result = selectAgentSelectedModel(state, 'agent-1', 'nonexistent/model');
    expect(result).toEqual(modelB);
  });
});
