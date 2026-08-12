import type { RootState } from '../index';

export const selectWorkMode = (state: RootState) => state.workMode.mode;
