import { expect, test, vi } from 'vitest';

import { destroyPdfDocument } from './DocumentRenderer';

test('destroys an active PDF document during renderer cleanup', async () => {
  const destroy = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

  await destroyPdfDocument({ destroy });

  expect(destroy).toHaveBeenCalledOnce();
});

test('ignores PDF destroy failures during cleanup', async () => {
  const destroy = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('already closed'));

  await expect(destroyPdfDocument({ destroy })).resolves.toBeUndefined();
  expect(destroy).toHaveBeenCalledOnce();
});
