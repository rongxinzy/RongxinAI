import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import type { Agent } from '../../types/agent';

interface AgentState {
  agents: Agent[];
  currentAgentId: string;
  loading: boolean;
}

const initialState: AgentState = {
  agents: [],
  currentAgentId: 'main',
  loading: false,
};

const agentSlice = createSlice({
  name: 'agent',
  initialState,
  reducers: {
    setAgents(state, action: PayloadAction<Agent[]>) {
      state.agents = action.payload;
    },

    setCurrentAgentId(state, action: PayloadAction<string>) {
      state.currentAgentId = action.payload;
    },

    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },

    addAgent(state, action: PayloadAction<Agent>) {
      state.agents.push(action.payload);
    },

    updateAgent(state, action: PayloadAction<{ id: string; updates: Partial<Agent> }>) {
      const index = state.agents.findIndex(a => a.id === action.payload.id);
      if (index !== -1) {
        state.agents[index] = { ...state.agents[index], ...action.payload.updates };
      }
    },

    removeAgent(state, action: PayloadAction<string>) {
      state.agents = state.agents.filter(a => a.id !== action.payload);
      if (state.currentAgentId === action.payload) {
        state.currentAgentId = 'main';
      }
    },
  },
});

export const { setAgents, setCurrentAgentId, setLoading, addAgent, updateAgent, removeAgent } =
  agentSlice.actions;

export default agentSlice.reducer;
