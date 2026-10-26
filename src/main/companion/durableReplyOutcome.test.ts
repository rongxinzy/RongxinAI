import { expect, test } from 'vitest';
import { companionRuntimeFixture } from '../../../tests/fixtures/companionRuntime';
import { CompanionRequestState as State } from '../../shared/companion/constants';

test('an explicit stop remains distinct from failure in receipts and after reopening', async () => {
  const f = await companionRuntimeFixture();
  try {
    f.hold(true);
    const runtime = f.create();
    const admitted = await runtime.submit(f.profile, 'stopped', 'Stop this input');
    await expect.poll(() => f.requests.length).toBe(1);
    expect((await runtime.history(f.profile)).lastReply).toEqual({
      ...admitted.receipt,
      state: State.Accepted,
    });
    await runtime.stop(f.profile);
    expect((await runtime.answer(f.profile, admitted.receipt!)).state).toBe(State.Stopped);
    expect((await runtime.history(f.profile)).lastReply).toEqual({
      ...admitted.receipt,
      state: State.Stopped,
    });
    await runtime.close();
    const reopened = f.create();
    await reopened.resume(f.profile);
    expect((await reopened.history(f.profile)).lastReply).toEqual({
      ...admitted.receipt,
      state: State.Stopped,
    });
    expect(f.requests).toHaveLength(1);
    expect((await reopened.history(f.profile)).messages[0].text).toBe('Stop this input');
  } finally {
    await f.cleanup();
  }
});

test('a failure is readable without polling and survives close until a later admitted reply', async () => {
  const f = await companionRuntimeFixture();
  try {
    f.failLocal();
    const runtime = f.create();
    const admitted = await runtime.submit(f.profile, 'failure', 'Keep the original question');
    await expect
      .poll(async () => (await runtime.history(f.profile)).lastReply?.state)
      .toBe(State.Unanswered);
    await runtime.close();
    const reopened = f.create();
    expect((await reopened.history(f.profile)).lastReply).toEqual({
      ...admitted.receipt,
      state: State.Unanswered,
    });
    expect(f.requests).toHaveLength(1);
    f.available(false);
    expect(
      (await reopened.submit(f.profile, 'draft', 'This draft has not been admitted')).receipt,
    ).toBeNull();
    expect((await reopened.history(f.profile)).lastReply?.state).toBe(State.Unanswered);
    f.available(true);
    f.failLocal(false);
    const next = await reopened.submit(f.profile, 'draft', 'Now continue');
    await expect
      .poll(async () => (await reopened.history(f.profile)).lastReply?.state)
      .toBe(State.Answered);
    expect((await reopened.history(f.profile)).lastReply).toEqual({
      ...next.receipt,
      state: State.Answered,
    });
    expect(f.requests).toHaveLength(2);
  } finally {
    await f.cleanup();
  }
});
