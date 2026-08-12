/**
 * The renderer service is the final bridge before preload IPC. Keep file
 * attachments here alongside vision attachments; otherwise a continuing turn
 * persists only a textual "input file" path and loses its message card.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./cowork.ts', import.meta.url)), 'utf8');

test('forwards file attachments when continuing a cowork session', () => {
  const continueStart = source.indexOf('async continueSession(options: CoworkContinueOptions)');
  const continueEnd = source.indexOf('\n  async stopSession', continueStart);
  const continueSource = source.slice(continueStart, continueEnd);

  expect(continueStart).toBeGreaterThanOrEqual(0);
  expect(continueSource).toContain('imageAttachments: options.imageAttachments');
  expect(continueSource).toContain('fileAttachments: options.fileAttachments');
});
