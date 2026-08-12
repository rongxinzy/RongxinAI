import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CoworkView.tsx', import.meta.url)),
  'utf8',
);

test('keeps both attachment kinds when a running Work session queues a prompt', () => {
  const queueStart = source.indexOf('coworkQueueService.enqueue(');
  const queueCall = source.slice(queueStart, source.indexOf(');', queueStart) + 2);

  expect(queueCall).toContain('imageAttachments');
  expect(queueCall).toContain('fileAttachments');
  expect(queueCall).toContain('[...activeSkillIds]');
  expect(queueCall).toContain('skillPrompt');
});
