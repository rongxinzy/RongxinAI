import { expect, test } from 'vitest';
import { CoworkRunPhase, type CoworkRunSnapshot } from '../../../shared/cowork/runState';
import reducer, { receiveRunSnapshot } from './coworkRunSlice';

const snapshot: CoworkRunSnapshot = {
  sessionId: 'a',
  runId: 'run',
  sequence: 2,
  startedAt: 1,
  confirmedAt: 2,
  lastProgressAt: 1,
  phase: CoworkRunPhase.Tool,
  running: true,
};
test('ignores stale sequences, old runs, and late running snapshots after completion', () => {
  let state = reducer(undefined, receiveRunSnapshot(snapshot));
  state = reducer(
    state,
    receiveRunSnapshot({
      ...snapshot,
      sequence: 3,
      phase: CoworkRunPhase.Completed,
      running: false,
    }),
  );
  for (const next of [
    snapshot,
    { ...snapshot, sequence: 4 },
    { ...snapshot, runId: 'old', startedAt: 0 },
  ]) {
    state = reducer(state, receiveRunSnapshot(next));
    expect(state.bySession.a.running).toBe(false);
  }
  state = reducer(state, receiveRunSnapshot({ ...snapshot, runId: 'new', startedAt: 3 }));
  expect(state.bySession.a.running).toBe(true);
});
test('a confirmation updates liveness without changing the progress timestamp', () => {
  let state = reducer(undefined, receiveRunSnapshot(snapshot));
  state = reducer(state, receiveRunSnapshot({ ...snapshot, confirmedAt: 100 }));
  expect(state.bySession.a.lastProgressAt).toBe(1);
  expect(state.bySession.a.confirmedAt).toBe(100);
});
