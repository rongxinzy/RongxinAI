import { expect, test, vi } from 'vitest';
import { settlePiWorkbenchCompletion } from './piWorkbenchCompletion';
import { WorkbenchVerificationOutcome } from '../../../shared/workbenchTask';

test('completion waits for verification, keeping the session busy', async () => {
  const active = { isRunning: false, completionPending: undefined as Promise<void> | undefined };
  let resolve!: (value: undefined) => void;
  const verification = new Promise<undefined>(done => {
    resolve = done;
  });
  const complete = vi.fn();
  const pending = settlePiWorkbenchCompletion(active, verification, () => true, complete, vi.fn());
  expect(active.isRunning).toBe(true);
  expect(active.completionPending).toBe(pending);
  expect(complete).not.toHaveBeenCalled();
  resolve(undefined);
  await pending;
  expect(complete).toHaveBeenCalledOnce();
  expect(active.isRunning).toBe(false);
  expect(active.completionPending).toBeUndefined();
});

test('failed verification is an error, while explicit acceptance remains distinguishable', async () => {
  for (const outcome of [
    WorkbenchVerificationOutcome.Failed,
    WorkbenchVerificationOutcome.AcceptanceRequired,
    WorkbenchVerificationOutcome.Passed,
  ]) {
    const result = { outcome, checks: [], evidence: [], summary: 'Verification result' };
    const complete = vi.fn();
    const failed = vi.fn();
    await settlePiWorkbenchCompletion(
      { isRunning: false },
      Promise.resolve(result),
      () => true,
      complete,
      failed,
    );
    if (outcome === WorkbenchVerificationOutcome.Failed) {
      expect(complete).not.toHaveBeenCalled();
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: result.summary }));
    } else {
      expect(failed).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledWith(result);
    }
  }
});
test('stopped or replaced runs cannot emit a delayed completion', async () => {
  const complete = vi.fn();
  const failed = vi.fn();
  await settlePiWorkbenchCompletion(
    { isRunning: false },
    Promise.resolve(undefined),
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
