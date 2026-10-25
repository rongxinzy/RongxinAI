import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import { companionRuntimeFixture } from '../../../tests/fixtures/companionRuntime';
import { CompanionActivityState as State, type CompanionActivity } from './activity';

test('native settlement updates activity without answer polling; stop is not failure', async () => {
  const f = await companionRuntimeFixture();
  const seen: CompanionActivity[] = [];
  try {
    const runtime = f.create();
    const unsubscribe = runtime.onActivity(activity => seen.push(activity));
    f.available(false);
    await runtime.submit(f.profile, 'no-model', 'Keep this draft');
    expect(seen).toEqual([]);
    f.available(true);
    f.hold(true);
    const held = await runtime.submit(f.profile, 'held', 'Wait here');
    expect(seen.map(item => item.state)).toEqual([State.Replying]);
    await expect.poll(() => f.requests.length).toBe(1);
    await runtime.resume(f.profile);
    await runtime.submit(f.profile, 'held', 'Lost receipt retry');
    expect(seen).toHaveLength(1);
    await runtime.stop(f.profile);
    await expect.poll(() => seen.at(-1)?.state).toBe(State.Stopped);
    expect(seen.at(-1)).toEqual({
      petId: f.profile.petId,
      submissionId: held.receipt!.submissionId,
      state: State.Stopped,
    });
    f.hold(false);
    const next = await runtime.submit(f.profile, 'next', 'Continue');
    await expect.poll(() => seen.at(-1)?.state).toBe(State.Answered);
    expect(seen.at(-1)?.submissionId).toBe(next.receipt!.submissionId);
    expect(f.requests).toHaveLength(2);
    const count = seen.length;
    await runtime.submit(f.profile, 'next', 'Duplicate settled receipt');
    await runtime.resume(f.profile);
    await runtime.history(f.profile);
    expect(seen).toHaveLength(count);
    unsubscribe();
    await runtime.close();
    expect(seen).toHaveLength(count);
  } finally {
    await f.cleanup();
  }
});

test('closing pauses the native waiter and resuming observes the same input once', async () => {
  const f = await companionRuntimeFixture();
  const seen: CompanionActivity[] = [];
  try {
    f.hold(true);
    const runtime = f.create();
    runtime.onActivity(activity => seen.push(activity));
    const admitted = await runtime.submit(f.profile, 'resume', 'Continue after reopening');
    await expect.poll(() => f.requests.length).toBe(1);
    await runtime.close();
    expect(seen.map(item => item.state)).toEqual([State.Replying, State.Inactive]);
    const reopened = f.create();
    reopened.onActivity(activity => seen.push(activity));
    f.available(false);
    await reopened.resume(f.profile);
    expect(seen).toHaveLength(2);
    f.available(true);
    f.hold(false);
    await reopened.resume(f.profile);
    await expect.poll(() => seen.at(-1)?.state).toBe(State.Answered);
    expect(seen.map(item => item.state)).toEqual([
      State.Replying,
      State.Inactive,
      State.Replying,
      State.Answered,
    ]);
    expect(seen.at(-1)?.submissionId).toBe(admitted.receipt!.submissionId);
    expect(f.requests).toHaveLength(2);
  } finally {
    await f.cleanup();
  }
});

test('switching owner retires unfinished activity and does not replay a settled celebration', async () => {
  const f = await companionRuntimeFixture();
  const seen: CompanionActivity[] = [];
  try {
    f.hold(true);
    const runtime = f.create();
    runtime.onActivity(activity => seen.push(activity));
    await runtime.submit(f.profile, 'old', 'Pending for this owner');
    await expect.poll(() => f.requests.length).toBe(1);
    f.hold(false);
    const other = { ...f.profile, petId: randomUUID() };
    await runtime.submit(other, 'new', 'Different companion');
    await expect.poll(() => seen.at(-1)?.state).toBe(State.Answered);
    expect(seen.map(item => [item.petId, item.state])).toEqual([
      [f.profile.petId, State.Replying],
      [f.profile.petId, State.Inactive],
      [other.petId, State.Replying],
      [other.petId, State.Answered],
    ]);
  } finally {
    await f.cleanup();
  }
});

test('provider failure is observed once and a broken listener cannot interrupt the reply', async () => {
  const f = await companionRuntimeFixture();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const seen: CompanionActivity[] = [];
  try {
    f.failLocal();
    const runtime = f.create();
    runtime.onActivity(() => {
      throw new Error('Broken optional projection');
    });
    runtime.onActivity(activity => seen.push(activity));
    await runtime.submit(f.profile, 'failure', 'Try this');
    await expect.poll(() => seen.at(-1)?.state).toBe(State.Failed);
    expect(f.requests).toHaveLength(1);
    await runtime.submit(f.profile, 'recovered', 'Next turn uses the available model');
    await expect.poll(() => seen.at(-1)?.state).toBe(State.Answered);
    expect(f.requests.map(item => item.model)).toEqual(['local', 'backup']);
  } finally {
    await f.cleanup();
    warn.mockRestore();
  }
});
