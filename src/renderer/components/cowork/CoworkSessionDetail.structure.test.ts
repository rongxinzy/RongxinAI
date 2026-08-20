import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CoworkSessionDetail.tsx', import.meta.url)),
  'utf8',
);

test('overlays inline permission approval on the prompt input', () => {
  const overlay = source.indexOf('className="absolute inset-x-0 bottom-0 z-20 px-4 pb-4"');
  const permissionContainer = source.indexOf(
    'className="w-full max-w-5xl min-w-[320px] mx-auto pl-4"',
    overlay,
  );
  const permission = source.indexOf('<CoworkPermissionModal', overlay);
  const inputArea = source.indexOf('{/* Input Area */}');
  const promptContainer = source.indexOf(
    'className="max-w-5xl min-w-[320px] mx-auto pl-4"',
    inputArea,
  );
  const promptInput = source.indexOf('<CoworkPromptInput', inputArea);

  expect(overlay).toBeGreaterThanOrEqual(0);
  expect(permissionContainer).toBeGreaterThan(overlay);
  expect(permission).toBeGreaterThan(permissionContainer);
  expect(inputArea).toBeGreaterThan(permission);
  expect(promptContainer).toBeGreaterThan(inputArea);
  expect(promptInput).toBeGreaterThan(promptContainer);
});
