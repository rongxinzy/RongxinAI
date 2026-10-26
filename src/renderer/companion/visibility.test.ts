import { expect, test, vi } from 'vitest';
import { watchCompanionVisibility } from './visibility';

function fixture() {
  let resolve!: (visible: boolean) => void;
  let reject!: (error: Error) => void;
  let notify!: (visible: boolean) => void;
  const changed = vi.fn();
  const failed = vi.fn();
  const unsubscribe = vi.fn();
  const initial = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const dispose = watchCompanionVisibility(
    {
      visibility: () => initial,
      onVisibility: listener => {
        notify = listener;
        return unsubscribe;
      },
    },
    changed,
    failed,
  );
  return { resolve, reject, notify, changed, failed, unsubscribe, dispose };
}

test('a prepared hidden window starts hidden and responds to its real first show', async () => {
  const f = fixture();
  f.resolve(false);
  await Promise.resolve();
  expect(f.changed.mock.calls).toEqual([[false]]);
  f.notify(true);
  expect(f.changed.mock.calls).toEqual([[false], [true]]);
  f.dispose();
});

test('a late initial visibility response cannot undo a newer native show', async () => {
  const f = fixture();
  f.notify(true);
  f.resolve(false);
  await Promise.resolve();
  expect(f.changed.mock.calls).toEqual([[true]]);
  f.dispose();
});

test('unmount cancels pending reads and unsubscribes, while live read failures are reported', async () => {
  const f = fixture();
  f.dispose();
  f.resolve(true);
  f.notify(true);
  await Promise.resolve();
  expect(f.changed).not.toHaveBeenCalled();
  expect(f.unsubscribe).toHaveBeenCalledOnce();
  const broken = fixture();
  broken.reject(new Error('Native visibility unavailable'));
  await Promise.resolve();
  expect(broken.failed).toHaveBeenCalledOnce();
  broken.dispose();
});
