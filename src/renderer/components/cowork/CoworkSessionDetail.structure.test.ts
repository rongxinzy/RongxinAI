import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CoworkSessionDetail.tsx', import.meta.url)),
  'utf8',
);

test('lets the conversation fill the pane behind the floating composer', () => {
  const inputArea = source.indexOf('{/* Input Area */}');
  const overlay = source.indexOf('ref={composerOverlayRef}', inputArea);
  const promptInput = source.indexOf('<CoworkPromptInput', inputArea);
  const permission = source.indexOf('<CoworkPermissionModal', promptInput);

  expect(source).toContain('const composerOverlayRef = useCoworkComposerInset(detailRootRef);');
  expect(source).toContain('style={{ height: `calc(${COWORK_COMPOSER_INSET_VALUE} + 1rem)` }}');
  expect(source).toContain('style={{ bottom: `calc(${COWORK_COMPOSER_INSET_VALUE} + 1rem)` }}');
  expect(inputArea).toBeGreaterThanOrEqual(0);
  expect(overlay).toBeGreaterThan(inputArea);
  expect(source.slice(overlay, promptInput)).toContain(
    'className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-4"',
  );
  expect(promptInput).toBeGreaterThan(overlay);
  expect(permission).toBeGreaterThan(promptInput);
});
