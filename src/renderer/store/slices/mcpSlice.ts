import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { McpServerConfig } from '../../types/mcp';

interface McpState {
  servers: McpServerConfig[];
}

const initialState: McpState = {
  servers: [],
};

const mcpSlice = createSlice({
  name: 'mcp',
  initialState,
  reducers: {
    setMcpServers: (state, action: PayloadAction<McpServerConfig[]>) => {
      state.servers = action.payload;
    },
  },
});

export const { setMcpServers } = mcpSlice.actions;

export default mcpSlice.reducer;
