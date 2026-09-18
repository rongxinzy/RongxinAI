import { expect, test, vi } from 'vitest';
import { settlePiWorkbenchCompletion } from './piWorkbenchCompletion';

test('completion waits for verification, keeping the session busy', async () => {
  const active = { isRunning: false, completionPending: undefined as Promise<void> | undefined };
  let resolve!: () => void;
  const verification = new Promise<void>(done => {
    resolve = done;
  });
  const complete = vi.fn();
  const pending = settlePiWorkbenchCompletion(active, verification, () => true, complete, vi.fn());
  expect(active.isRunning).toBe(true);
  expect(active.completionPending).toBe(pending);
  expect(complete).not.toHaveBeenCalled();
  resolve();
  await pending;
  expect(complete).toHaveBeenCalledOnce();
  expect(active.isRunning).toBe(false);
  expect(active.completionPending).toBeUndefined();
});
test('stopped or replaced runs cannot emit a delayed completion', async () => {
  const complete = vi.fn();
  const failed = vi.fn();
  await settlePiWorkbenchCompletion(
    { isRunning: false },
    Promise.resolve(),
    () => false,
    complete,
    failed,
  );
  expect(complete).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});
test('verification errors surface once instead of emitting success', async () => {
  const complete = vi.fn();
  const failed = vi.fn();
  const error = new Error('Database unavailable');
  await settlePiWorkbenchCompletion(
    { isRunning: false },
    Promise.reject(error),
    () => true,
    complete,
    failed,
  );
  expect(complete).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledWith(error);
});
