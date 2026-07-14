import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { LlamaCppOpenClawEligibility } from '../../../shared/llamacpp';
import { defaultConfig, getProviderDisplayName } from '../../config';
import { resolveOpenClawModelRef } from '../../utils/openclawModelRef';

export interface Model {
  id: string;
  name: string;
  provider?: string;
  providerKey?: string;
  openClawProviderId?: string;
  supportsImage?: boolean;
  supportsThinkingToggle?: boolean;
  isServerModel?: boolean;
  serverApiFormat?: string;
  llamaCppOpenClawEligibility?: LlamaCppOpenClawEligibility;
  llamaCppRuntimeContextWindow?: number;
  llamaCppTrainedContextWindow?: number;
}

export function getModelIdentityKey(model: Pick<Model, 'id' | 'providerKey'>): string {
  return `${model.providerKey ?? ''}::${model.id}`;
}

export function isSameModelIdentity(
  modelA: Pick<Model, 'id' | 'providerKey'>,
  modelB: Pick<Model, 'id' | 'providerKey'>
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
          models.push({
            id: model.id,
            name: model.name,
            provider: getProviderDisplayName(providerName, config),
            providerKey: providerName,
            supportsImage: model.supportsImage ?? false,
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
    const resolved = resolveOpenClawModelRef(trimmed, modelState.availableModels);
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
    } else {
      delete selectedModelByAgent[agentId];
    }
  }
}

const initialState: ModelState = {
  defaultSelectedModel: availableModels.find(
    model => model.id === defaultConfig.model.defaultModel
      && (!defaultModelProvider || model.providerKey === defaultModelProvider)
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
      const serverModels = state.availableModels.filter(m => m.isServerModel);
      state.availableModels = [...serverModels, ...action.payload];
      availableModels = state.availableModels;
      if (state.availableModels.length > 0) {
        const matchedModel = state.availableModels.find(
          m => isSameModelIdentity(m, state.defaultSelectedModel),
        );
        state.defaultSelectedModel = matchedModel ?? state.availableModels[0];
      }
      syncSelectedModelByAgent(state.selectedModelByAgent, state.availableModels);
    },
    setServerModels: (state, action: PayloadAction<Model[]>) => {
      const userModels = state.availableModels.filter(m => !m.isServerModel);
      state.availableModels = [...action.payload, ...userModels];
      availableModels = state.availableModels;
      if (state.availableModels.length > 0) {
        const matchedModel = state.availableModels.find(
          m => isSameModelIdentity(m, state.defaultSelectedModel),
        );
        state.defaultSelectedModel = matchedModel ?? state.availableModels[0];
      }
      syncSelectedModelByAgent(state.selectedModelByAgent, state.availableModels);
    },
    clearServerModels: (state) => {
      state.availableModels = state.availableModels.filter(m => !m.isServerModel);
      availableModels = state.availableModels;
      if (state.defaultSelectedModel.isServerModel && state.availableModels.length > 0) {
        state.defaultSelectedModel = state.availableModels[0];
      }
      syncSelectedModelByAgent(state.selectedModelByAgent, state.availableModels);
    },
  },
});

export const {
  setSelectedModel,
  setDefaultSelectedModel,
  clearAgentSelectedModel,
  setAvailableModels,
  setServerModels,
  clearServerModels,
} = modelSlice.actions;
export default modelSlice.reducer;
