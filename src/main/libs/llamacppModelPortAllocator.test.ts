import { expect, test } from 'vitest';

import { LlamaCppModelPortAllocator } from './llamacppModelPortAllocator';

test('assigns distinct ports to concurrent model processes', async () => {
  const allocator = new LlamaCppModelPortAllocator();

  const first = await allocator.reserve('model-a');
  const second = await allocator.reserve('model-b');

  expect(first.port).not.toBe(second.port);
  await expect(allocator.reserve('model-a')).resolves.toEqual(first);
});

test('reuses a released port for the next model process', async () => {
  const allocator = new LlamaCppModelPortAllocator();
  const first = await allocator.reserve('model-a');

  allocator.release('model-a');

  expect((await allocator.reserve('model-b')).port).toBe(first.port);
});
