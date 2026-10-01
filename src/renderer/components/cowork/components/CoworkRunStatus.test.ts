// @vitest-environment jsdom
import { createElement } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { render, screen, act } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import {
  CoworkRunPhase,
  CoworkRunPolicy,
  type CoworkRunSnapshot,
} from '../../../../shared/cowork/runState';
import runReducer, { receiveRunSnapshot } from '../../../store/slices/coworkRunSlice';
import { CoworkRunStatus, getRunStatusText } from './CoworkRunStatus';
vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
afterEach(() => vi.useRealTimers());
const snapshot: CoworkRunSnapshot = {
  sessionId: 'a',
  runId: 'run',
  sequence: 1,
  startedAt: 1,
  confirmedAt: 100,
  lastProgressAt: 10,
  phase: CoworkRunPhase.Tool,
  running: true,
  toolName: 'bash',
  preview: 'step 4 complete',
};
test('status is independent of transcript visibility and uses authoritative elapsed time', () => {
  vi.useFakeTimers();
  vi.setSystemTime(100);
  const store = configureStore({ reducer: { coworkRun: runReducer } });
  store.dispatch(receiveRunSnapshot(snapshot));
  const providerProps = { store, children: null };
  const view = render(
    createElement(
      Provider,
      providerProps,
      createElement(CoworkRunStatus, { sessionId: 'a', isStreaming: true }),
    ),
  );
  expect(screen.getByRole('status').textContent).toContain('coworkRunIndicatorRunning');
  expect(screen.getByRole('status').textContent).not.toContain('step 4 complete');
  expect(screen.getByRole('status').textContent).not.toContain('bash');
  expect(screen.getByRole('status').textContent).toContain('00:00');
  act(() => vi.advanceTimersByTime(2_000));
  expect(screen.getByRole('status').textContent).toContain('00:02');
  act(() =>
    store.dispatch(
      receiveRunSnapshot({
        ...snapshot,
        sequence: 2,
        running: false,
        phase: CoworkRunPhase.Completed,
      }),
    ),
  );
  view.rerender(
    createElement(
      Provider,
      providerProps,
      createElement(CoworkRunStatus, { sessionId: 'a', isStreaming: false }),
    ),
  );
  expect(screen.queryByRole('status')).toBeNull();
});
test('does not claim the background is alive when confirmations stop', () => {
  expect(getRunStatusText(snapshot, snapshot.confirmedAt + CoworkRunPolicy.UnconfirmedMs + 1)).toBe(
    'coworkRunIndicatorReconnecting',
  );
});
