import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CoworkSessionDetail.tsx', import.meta.url)),
  'utf8',
);

test('anchors inline permission approval directly above the prompt input', () => {
  const inputArea = source.indexOf('{/* Input Area */}');
  const permission = source.indexOf('<CoworkPermissionModal', inputArea);
  const promptInput = source.indexOf('<CoworkPromptInput', inputArea);

  expect(inputArea).toBeGreaterThanOrEqual(0);
  expect(permission).toBeGreaterThan(inputArea);
  expect(promptInput).toBeGreaterThan(permission);
  expect(source.slice(inputArea, permission)).toContain('className="mb-2"');
  expect(source).not.toContain('absolute inset-x-0 bottom-0 z-20 px-4 pb-4');
});
