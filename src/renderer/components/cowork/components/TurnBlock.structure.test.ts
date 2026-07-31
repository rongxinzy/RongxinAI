import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./TurnBlock.tsx', import.meta.url)), 'utf8');

test('keeps execution groups collapsed while resetting state when streaming completes', () => {
  expect(source).toContain("key={`${groupKey}-${isStreaming ? 'active' : 'complete'}`}");
  expect(source).toMatch(
    /<ChainOfThought\s+key=\{`\$\{groupKey\}-\$\{isStreaming \? 'active' : 'complete'\}`\}\s+defaultOpen=\{false\}/,
  );
});
