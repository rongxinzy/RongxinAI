import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./CodingEventStream.tsx', import.meta.url)), 'utf8');

test('keeps coding tool expansion state keyed by activity id', () => {
  expect(source).toContain('useState<ReadonlySet<string>>');
  expect(source).toContain('expandedActivityIds={expandedActivityIds}');
  expect(source).toContain('onActivityOpenChange={setActivityOpen}');
});

test('does not render a separate batch tool control outside the thinking group', () => {
  expect(source).not.toContain('toggleAllTools');
  expect(source).not.toContain('ChevronsDownUp');
});
