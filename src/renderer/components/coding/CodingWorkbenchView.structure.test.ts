import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CodingWorkbenchView.tsx', import.meta.url)),
  'utf8',
);

test('keeps the manager dialog with its sidebar event hook and removes the toolbar entry', () => {
  expect(source).toContain('useCodingAgentManager()');
  expect(source).toContain('<CodingAgentManager');
  expect(source).not.toContain('<Settings2 />');
});

test('floats the approval card over the composer slot like work mode', () => {
  const composerIndex = source.indexOf('<CodingComposer');
  const overlayIndex = source.indexOf('<CodingPermissionOverlay');
  expect(composerIndex).toBeGreaterThan(-1);
  expect(overlayIndex).toBeGreaterThan(composerIndex);
  expect(source).toContain('permission={activePermission}');
});
