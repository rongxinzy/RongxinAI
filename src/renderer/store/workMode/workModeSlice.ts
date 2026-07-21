import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { WorkMode, type WorkMode as WorkModeValue } from './constants';

interface WorkModeState {
  mode: WorkModeValue;
}

const initialState: WorkModeState = {
  mode: WorkMode.Work,
};

const workModeSlice = createSlice({
  name: 'workMode',
  initialState,
  reducers: {
    setWorkMode(state, action: PayloadAction<WorkModeValue>) {
      state.mode = action.payload;
    },
  },
});

export const { setWorkMode } = workModeSlice.actions;

export default workModeSlice.reducer;
