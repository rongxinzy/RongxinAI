import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

// Moved from CoworkSessionDetail.structure.test.ts when the artifact panel
// open/close transition moved into useArtifactPanelPresentation.
const source = readFileSync(
  fileURLToPath(new URL('./useArtifactPanelPresentation.ts', import.meta.url)),
  'utf8',
);

test('unmounts the artifact panel after its close transition', () => {
  const closeBranchStart = source.indexOf('} else {', source.indexOf('if (isPanelOpen)'));
  const closeBranchEnd = source.indexOf('return () =>', closeBranchStart);

  expect(closeBranchStart).toBeGreaterThan(0);
  expect(closeBranchEnd).toBeGreaterThan(closeBranchStart);
  expect(source.slice(closeBranchStart, closeBranchEnd)).toContain(
    'setShouldRenderArtifactPanel(false);',
  );
});
