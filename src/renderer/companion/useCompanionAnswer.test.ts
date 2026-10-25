// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { CompanionRequestState } from '../../shared/companion/constants';
import type {
  CompanionAnswer,
  CompanionReceipt,
  CompanionWindowApi,
} from '../../shared/companion/types';
import { useCompanionAnswer } from './useCompanionAnswer';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const receipt = { petId: 'pet-a', requestId: 'request', submissionId: 1 };

test('new bootstrap objects for the same receipt do not restart polling', async () => {
  vi.useFakeTimers();
  const answer = vi.fn(async () => ({
    ...receipt,
    state: CompanionRequestState.Accepted,
    text: '',
  }));
  const api = { answer } as unknown as CompanionWindowApi;
  const reload = vi.fn(async () => {}),
    onError = vi.fn();
  const { rerender } = renderHook(
    ({ pending }: { pending: CompanionReceipt }) =>
      useCompanionAnswer({ api, pending, visible: true, reload, onError }),
    { initialProps: { pending: receipt } },
  );
  await act(async () => {});
  for (let i = 0; i < 10; i++) rerender({ pending: { ...receipt } });
  expect(answer).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(answer).toHaveBeenCalledTimes(2);
  expect(reload).not.toHaveBeenCalled();
});

test('a hidden or switched surface cannot apply a late answer from the previous receipt', async () => {
  let resolve: (answer: CompanionAnswer) => void = () => {};
  const answer = vi.fn(
    () =>
      new Promise<CompanionAnswer>(done => {
        resolve = done;
      }),
  );
  const api = { answer } as unknown as CompanionWindowApi;
  const reload = vi.fn(async () => {}),
    onError = vi.fn();
  const { rerender } = renderHook(
    ({ visible }) => useCompanionAnswer({ api, pending: receipt, visible, reload, onError }),
    { initialProps: { visible: true } },
  );
  rerender({ visible: false });
  await act(async () => {
    resolve({ ...receipt, state: CompanionRequestState.Answered, text: 'old answer' });
  });
  expect(reload).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});
