import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { CoworkRunSnapshot } from '../../../shared/cowork/runState';
import { deleteSession, deleteSessions } from './coworkSlice';

interface RunState {
  bySession: Record<string, CoworkRunSnapshot>;
  awaitingSince: Record<string, number>;
}
const initialState: RunState = { bySession: {}, awaitingSince: {} };

export function acceptsRunSnapshot(
  previous: CoworkRunSnapshot | undefined,
  next: CoworkRunSnapshot,
): boolean {
  if (!previous) return true;
  if (previous.runId !== next.runId) return next.startedAt > previous.startedAt;
  return (
    next.sequence >= previous.sequence &&
    (previous.running || !next.running) &&
    (next.sequence !== previous.sequence || next.confirmedAt >= previous.confirmedAt)
  );
}

const slice = createSlice({
  name: 'coworkRun',
  initialState,
  reducers: {
    expectRunStart(state, action: PayloadAction<{ sessionId: string; startedAt: number }>) {
      state.awaitingSince[action.payload.sessionId] = action.payload.startedAt;
    },
    receiveRunSnapshot(state, action: PayloadAction<CoworkRunSnapshot>) {
      const next = action.payload;
      if (next.startedAt < (state.awaitingSince[next.sessionId] ?? 0)) return;
      if (acceptsRunSnapshot(state.bySession[next.sessionId], next)) {
        state.bySession[next.sessionId] = next;
        delete state.awaitingSince[next.sessionId];
      }
    },
  },
  extraReducers: builder => {
    builder.addCase(deleteSession, (state, action) => {
      delete state.bySession[action.payload];
      delete state.awaitingSince[action.payload];
    });
    builder.addCase(deleteSessions, (state, action) => {
      for (const id of action.payload) {
        delete state.bySession[id];
        delete state.awaitingSince[id];
      }
    });
  },
});
export const { receiveRunSnapshot, expectRunStart } = slice.actions;
export default slice.reducer;
