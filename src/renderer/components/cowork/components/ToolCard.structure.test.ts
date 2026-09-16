import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./ToolCard.tsx', import.meta.url)), 'utf8');

test('passes the persisted tool expansion state to the card header', () => {
  expect(source).toContain('isOpen={isCardOpen}');
});

test('embeds tool permission actions in the bash terminal instead of a second card', () => {
  expect(source).toContain('variant={isBashTool ? \'terminal\' : \'light\'}');
  expect(source).toContain('{permissionBar}');
});
