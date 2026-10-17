import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { LlamaCppAgentEligibility } from '../../../shared/llamacpp';
import type { ModelCapabilities } from '../../../shared/providers';

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
const EMPTY_MODEL: Model = { id: '', name: '' };
export function getModelIdentityKey(model: Pick<Model, 'id'>): string {
  return model.id;
}
export function isSameModelIdentity(a: Pick<Model, 'id'>, b: Pick<Model, 'id'>): boolean {
  return a.id === b.id;
}
interface ModelState {
  defaultSelectedModel: Model;
  selectedModelByAgent: Record<string, Model>;
  availableModels: Model[];
}
export function selectAgentSelectedModel(state: ModelState, agentId: string, ref: string): Model {
  const id = state.selectedModelByAgent[agentId]?.id || ref.trim();
  return state.availableModels.find(model => model.id === id) ?? state.defaultSelectedModel;
}
const initialState: ModelState = {
  defaultSelectedModel: EMPTY_MODEL,
  selectedModelByAgent: {},
  availableModels: [],
};
const modelSlice = createSlice({
  name: 'model',
  initialState,
  reducers: {
    setSelectedModel(state, action: PayloadAction<{ agentId: string; model: Model }>) {
      state.selectedModelByAgent[action.payload.agentId] = action.payload.model;
    },
    clearAgentSelectedModel(state, action: PayloadAction<string>) {
      delete state.selectedModelByAgent[action.payload];
    },
    setModelCatalog(
      state,
      action: PayloadAction<{ models: Model[]; defaultModelId: string | null }>,
    ) {
      state.availableModels = action.payload.models;
      state.defaultSelectedModel =
        action.payload.models.find(model => model.id === action.payload.defaultModelId) ??
        EMPTY_MODEL;
      for (const [agentId, model] of Object.entries(state.selectedModelByAgent)) {
        const current = action.payload.models.find(item => item.id === model.id);
        if (current) state.selectedModelByAgent[agentId] = current;
        else delete state.selectedModelByAgent[agentId];
      }
    },
  },
});
export const { setSelectedModel, clearAgentSelectedModel, setModelCatalog } = modelSlice.actions;
export default modelSlice.reducer;
