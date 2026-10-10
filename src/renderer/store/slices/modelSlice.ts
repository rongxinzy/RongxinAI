import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { LlamaCppAgentEligibility } from '../../../shared/llamacpp';
import { type ModelCapabilities, ProviderName, ProviderRegistry } from '../../../shared/providers';
import { defaultConfig, getProviderDisplayName } from '../../config';
import { resolveAgentModelRef } from '../../utils/agentModelRef';

export interface Model {
  id: string;
  name: string;
  provider?: string;
  providerKey?: string;
  agentProviderId?: string;
  supportsImage?: boolean;
  capabilities?: Partial<ModelCapabilities>;
  supportsThinkingToggle?: boolean;
  contextWindow?: number;
  llamaCppAgentEligibility?: LlamaCppAgentEligibility;
  llamaCppRuntimeContextWindow?: number;
  llamaCppTrainedContextWindow?: number;
}

export function getModelIdentityKey(model: Pick<Model, 'id' | 'providerKey'>): string {
  return `${model.providerKey ?? ''}::${model.id}`;
}

export function isSameModelIdentity(
  modelA: Pick<Model, 'id' | 'providerKey'>,
  modelB: Pick<Model, 'id' | 'providerKey'>,
): boolean {
  if (modelA.id !== modelB.id) {
    return false;
  }
  if (modelA.providerKey && modelB.providerKey) {
    return modelA.providerKey === modelB.providerKey;
  }
  return true;
}

function buildInitialModels(): Model[] {
  const models: Model[] = [];
  if (defaultConfig.providers) {
    Object.entries(defaultConfig.providers).forEach(([providerName, config]) => {
      if (config.enabled && config.models) {
        config.models.forEach(model => {
          const supportsImage = ProviderRegistry.resolveModelSupportsImage(
            providerName,
            model.id,
            model.supportsImage,
          );
          models.push({
            id: model.id,
            name: model.name,
            provider: getProviderDisplayName(providerName, config),
            providerKey: providerName,
            supportsImage,
            capabilities: ProviderRegistry.resolveModelCapabilities(
              providerName,
              model.id,
              config.apiFormat ?? 'anthropic',
              { ...model, supportsImage },
            ),
            contextWindow: model.contextWindow ?? model.contextTokens,
          });
        });
      }
    });
  }
  return models.length > 0 ? models : defaultConfig.model.availableModels;
}

export let availableModels: Model[] = buildInitialModels();
const defaultModelProvider = defaultConfig.model.defaultModelProvider;

interface ModelState {
  defaultSelectedModel: Model;
  selectedModelByAgent: Record<string, Model>;
  availableModels: Model[];
}

export function selectAgentSelectedModel(
  modelState: ModelState,
  agentId: string,
  agentModelRef: string,
): Model {
  const override = modelState.selectedModelByAgent[agentId];
  if (override) return override;
  const trimmed = agentModelRef.trim();
  if (trimmed) {
    const resolved = resolveAgentModelRef(trimmed, modelState.availableModels);
    if (resolved) return resolved;
  }
  return modelState.defaultSelectedModel;
}

function syncSelectedModelByAgent(
  selectedModelByAgent: Record<string, Model>,
  allAvailableModels: Model[],
): void {
  for (const agentId of Object.keys(selectedModelByAgent)) {
    const agentModel = selectedModelByAgent[agentId];
    const matched = allAvailableModels.find(m => isSameModelIdentity(m, agentModel));
    if (matched) {
      selectedModelByAgent[agentId] = matched;
    }
    // Models hidden by a transient refresh (e.g. an in-flight connection test)
    // must not drop the user's selection: keep the entry so the picker's
    // selection is restored once the model reappears.
  }
}

const initialState: ModelState = {
  defaultSelectedModel:
    availableModels.find(
      model =>
        model.id === defaultConfig.model.defaultModel &&
        (!defaultModelProvider || model.providerKey === defaultModelProvider),
    ) || availableModels[0],
  selectedModelByAgent: {},
  availableModels: availableModels,
};

const modelSlice = createSlice({
  name: 'model',
  initialState,
  reducers: {
    setSelectedModel: (state, action: PayloadAction<{ agentId: string; model: Model }>) => {
      state.selectedModelByAgent[action.payload.agentId] = action.payload.model;
    },
    setDefaultSelectedModel: (state, action: PayloadAction<Model>) => {
      state.defaultSelectedModel = action.payload;
    },
    clearAgentSelectedModel: (state, action: PayloadAction<string>) => {
      delete state.selectedModelByAgent[action.payload];
    },
    setAvailableModels: (state, action: PayloadAction<Model[]>) => {
      state.availableModels = action.payload;
      availableModels = state.availableModels;
      if (state.availableModels.length > 0) {
        const matchedModel = state.availableModels.find(m =>
          isSameModelIdentity(m, state.defaultSelectedModel),
        );
        // A model temporarily missing from the list (hidden by the connection
        // test gate) must not permanently rewrite the default: keep the stored
        // object so the previous default is restored on the next refresh.
        if (matchedModel) {
          state.defaultSelectedModel = matchedModel;
        }
      }
      syncSelectedModelByAgent(state.selectedModelByAgent, state.availableModels);
    },
    // Drop selections whose model is gone from the stored config entirely
    // (deleted model or provider). Hidden-but-configured models keep their
    // selection via syncSelectedModelByAgent; selections backed by dynamic
    // sources (llama.cpp runtime, managed pool) or no provider key are not
    // governed by the stored config and are always kept.
    pruneUnconfiguredSelectedModels: (state, action: PayloadAction<readonly string[]>) => {
      const configuredKeys = new Set(action.payload);
      for (const agentId of Object.keys(state.selectedModelByAgent)) {
        const agentModel = state.selectedModelByAgent[agentId];
        if (
          !agentModel.providerKey ||
          agentModel.providerKey === ProviderName.LlamaCpp ||
          agentModel.providerKey === ProviderName.Zhiyuan
        ) {
          continue;
        }
        if (!configuredKeys.has(getModelIdentityKey(agentModel))) {
          delete state.selectedModelByAgent[agentId];
        }
      }
    },
  },
});

export const {
  setSelectedModel,
  setDefaultSelectedModel,
  clearAgentSelectedModel,
  setAvailableModels,
  pruneUnconfiguredSelectedModels,
} = modelSlice.actions;
export default modelSlice.reducer;
