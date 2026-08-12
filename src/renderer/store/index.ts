import { configureStore } from '@reduxjs/toolkit';

import agentReducer from './slices/agentSlice';
import artifactReducer from './slices/artifactSlice';
import activityReducer from './slices/activitySlice';
import coworkReducer from './slices/coworkSlice';
import imReducer from './slices/imSlice';
import mcpReducer from './slices/mcpSlice';
import modelReducer from './slices/modelSlice';
import quickActionReducer from './slices/quickActionSlice';
import scheduledTaskReducer from './slices/scheduledTaskSlice';
import skillReducer from './slices/skillSlice';
import workspaceReducer from './slices/workspaceSlice';
import workModeReducer from './workMode/workModeSlice';

export const store = configureStore({
  reducer: {
    model: modelReducer,
    cowork: coworkReducer,
    skill: skillReducer,
    mcp: mcpReducer,
    im: imReducer,
    quickAction: quickActionReducer,
    scheduledTask: scheduledTaskReducer,
    agent: agentReducer,
    artifact: artifactReducer,
    activity: activityReducer,
    workspace: workspaceReducer,
    workMode: workModeReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
