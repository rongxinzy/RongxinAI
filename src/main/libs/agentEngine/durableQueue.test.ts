import { expect, test } from 'vitest';
import { nativeQueueFixture } from './durableQueue.testHarness';

const texts = (
  items: Awaited<ReturnType<Awaited<ReturnType<typeof nativeQueueFixture>>['inbox']>>,
) =>
  items.flatMap(item =>
    item.mode === 'write'
      ? []
      : [typeof item.content === 'string' ? item.content : JSON.stringify(item.content)],
  );

test('native queue editing/deletion retains exactly the latest user inputs during an active generation', async () => {
  const f = await nativeQueueFixture();
  await expect.poll(() => f.faux.state.callCount).toBe(1);
  const first = f.adapter.enqueuePendingMessage('queue', 'Original A').item!;
  const second = f.adapter.enqueuePendingMessage('queue', 'Remove B').item!;
  await expect.poll(async () => texts(await f.inbox())).toEqual(['Original A', 'Remove B']);
  expect(f.adapter.updatePendingMessage('queue', first.id, 'Edited A').success).toBe(true);
  expect(f.adapter.deletePendingMessage('queue', second.id).success).toBe(true);
  expect(f.adapter.enqueuePendingMessage('queue', 'New C').success).toBe(true);
  await expect.poll(async () => texts(await f.inbox())).toEqual(['Edited A', 'New C']);
  await f.settle();
  expect(await f.users()).toEqual(['Start', 'Edited A', 'New C']);
  expect(
    f.messages.filter(message => message.type === 'user').map(message => message.content),
  ).toEqual(['Start', 'Edited A', 'New C']);
});

test('promoting one queued input to steer never replays its previous follow-up receipt', async () => {
  const f = await nativeQueueFixture();
  await expect.poll(() => f.faux.state.callCount).toBe(1);
  const steer = f.adapter.enqueuePendingMessage('queue', 'Steer now').item!;
  f.adapter.enqueuePendingMessage('queue', 'Follow later');
  await expect.poll(async () => texts(await f.inbox())).toEqual(['Steer now', 'Follow later']);
  const promoted = f.adapter.steerPendingMessage('queue', steer.id);
  await expect.poll(async () => texts(await f.inbox())).toEqual(['Steer now']);
  await f.settle();
  expect((await promoted).success).toBe(true);
  await expect.poll(() => f.adapter.listPendingMessages('queue')).toEqual([]);
  expect(await f.users()).toEqual(['Start', 'Steer now', 'Follow later']);
});
