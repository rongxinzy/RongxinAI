// @vitest-environment jsdom
import { configureStore, type UnknownAction } from '@reduxjs/toolkit';
import { afterEach, expect, test, vi } from 'vitest';
import { CoworkRunPhase, type CoworkRunSnapshot } from '../../shared/cowork/runState';
import coworkReducer from '../store/slices/coworkSlice';
import runReducer, { expectRunStart } from '../store/slices/coworkRunSlice';
import { CoworkRunSync } from './coworkRunSync';

vi.mock('../store', () => ({
  store: {
    getState: () => testStore.getState(),
    dispatch: (action: UnknownAction) => testStore.dispatch(action),
  },
}));
const makeStore = () =>
  configureStore({ reducer: { cowork: coworkReducer, coworkRun: runReducer } });
let testStore = makeStore();
const snapshot: CoworkRunSnapshot = {
  sessionId: 'a',
  runId: 'run',
  sequence: 1,
  running: true,
  phase: CoworkRunPhase.Tool,
  startedAt: 10,
  confirmedAt: 20,
  lastProgressAt: 10,
};
afterEach(() => {
  vi.unstubAllGlobals();
  testStore = makeStore();
});

test('recovery delegates lifecycle and history before replaying content', async () => {
  const getRunSnapshot = vi.fn().mockResolvedValue({ success: true, snapshot, running: true });
  vi.stubGlobal('window', { electron: { cowork: { getRunSnapshot } } });
  const order: string[] = [];
  const canonical = vi.fn(async () => {
    order.push('canonical');
  });
  const sync = new CoworkRunSync(() => {
    order.push('flush');
  }, canonical);
  await sync.recover('a');
  expect(order).toEqual(['flush', 'canonical']);
  expect(canonical).toHaveBeenCalledWith('a');
  expect(getRunSnapshot).toHaveBeenLastCalledWith('a', true);
  expect(testStore.getState().coworkRun.bySession.a).toEqual(snapshot);
  expect(testStore.getState().cowork.streamingSessionIds).toEqual([]);
});

test('quiet Chat and Work both recover through the canonical runtime protocol', async () => {
  vi.stubGlobal('window', {
    electron: {
      cowork: {
        getRunSnapshot: vi
          .fn()
          .mockResolvedValue({ success: true, snapshot: null, running: false }),
      },
    },
  });
  const canonical = vi.fn().mockResolvedValue(undefined);
  await new CoworkRunSync(vi.fn(), canonical).recover('a');
  expect(canonical).toHaveBeenCalledOnce();
});

test('the previous completed run cannot replace a new prompt indicator', () => {
  testStore.dispatch(expectRunStart({ sessionId: 'a', startedAt: 100 }));
  const sync = new CoworkRunSync(vi.fn(), vi.fn());
  sync.receive({ ...snapshot, running: false, phase: CoworkRunPhase.Completed });
  expect(testStore.getState().coworkRun.bySession.a).toBeUndefined();
  sync.receive({ ...snapshot, runId: 'new', startedAt: 101 });
  expect(testStore.getState().coworkRun.awaitingSince.a).toBeUndefined();
  sync.receive({
    ...snapshot,
    runId: 'new',
    startedAt: 101,
    sequence: 2,
    running: false,
    phase: CoworkRunPhase.Completed,
  });
  expect(testStore.getState().coworkRun.bySession.a.running).toBe(false);
  expect(testStore.getState().cowork.streamingSessionIds).toEqual([]);
});
